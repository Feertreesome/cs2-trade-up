import type { Job, JobState } from "bullmq";
import { Queue } from "bullmq";
import type { Prisma } from "@prisma/client";
import type { SteamCollectionTag, SearchItem } from "../steam/repo";
import {
  fetchCollectionTags,
  searchByCollection,
  RARITY_TO_TAG,
} from "../steam/repo";
import { STEAM_MAX_AUTO_LIMIT, STEAM_PAGE_SIZE } from "../../config";
import { baseFromMarketHash, parseMarketHashExterior } from "../skins/service";
import { getSkinFloatRange, type SkinFloatRange } from "../tradeups/floatRanges";
import { prisma } from "../../database/client";
import { markCatalogReady } from "../../database/status";
import { COLLECTIONS_WITH_FLOAT } from "../../../../data/CollectionsWithFloat";
import { redisConnection } from "../../queues/connection";

interface PersistedSkin {
  marketHashName: string;
  marketName: string;
  baseName: string;
  exterior: string;
  rarity: string;
  weaponType?: string | null;
  isStatTrak: boolean;
  isSouvenir: boolean;
  sellListings: number;
  lastKnownPrice: number | null;
  classId?: string | null;
  instanceId?: string | null;
  iconUrl?: string | null;
  tradable?: boolean | null;
  floatMin?: number | null;
  floatMax?: number | null;
}

export interface SyncJobProgress {
  totalCollections: number;
  syncedCollections: number;
  currentCollectionTag?: string;
  currentCollectionName?: string;
  currentRarity?: string;
}

export interface SyncJobStatus {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
  progress: SyncJobProgress;
}

export type CatalogSyncJobName = "full-catalog-sync";

export interface CatalogSyncJobData {
  triggeredBy?: "manual" | "schedule";
}

export type CatalogSyncJob = Job<CatalogSyncJobData, void, CatalogSyncJobName>;

const queueName = process.env.CATALOG_SYNC_QUEUE ?? "catalog-sync";

export const catalogSyncQueue = new Queue<CatalogSyncJobData, void, CatalogSyncJobName>(queueName, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: {
      age: 60 * 60 * 24,
      count: 10,
    },
    removeOnFail: {
      age: 60 * 60 * 24 * 3,
      count: 25,
    },
  },
});

const rarityOrder = Object.keys(RARITY_TO_TAG) as (keyof typeof RARITY_TO_TAG)[];

const initialProgress = (): SyncJobProgress => ({
  totalCollections: 0,
  syncedCollections: 0,
});

const detectStatTrak = (marketName: string) => /StatTrak/i.test(marketName);
const detectSouvenir = (marketName: string) => /^Souvenir /i.test(marketName);

const guessCollectionId = (baseNames: Set<string>): string | null => {
  for (const entry of COLLECTIONS_WITH_FLOAT) {
    const hasMatch =
      entry.covert.some((covert) => baseNames.has(covert.baseName)) ||
      entry.classified.some((classified) => baseNames.has(classified.baseName));
    if (hasMatch) return entry.id;
  }
  return null;
};

const fetchEntireCollection = async (
  collectionTag: string,
  rarity?: keyof typeof RARITY_TO_TAG,
): Promise<SearchItem[]> => {
  const items: SearchItem[] = [];
  let start = 0;

  while (true) {
    const remaining = STEAM_MAX_AUTO_LIMIT - start;
    if (remaining <= 0) break;
    const requestCount = Math.min(STEAM_PAGE_SIZE, remaining);

    const { items: pageItems, total: totalCount } = await searchByCollection({
      collectionTag,
      rarity,
      start,
      count: requestCount,
      normalOnly: true,
    });

    if (!pageItems.length) break;

    items.push(...pageItems);
    start += pageItems.length;

    if (start >= totalCount || start >= STEAM_MAX_AUTO_LIMIT) break;
    if (pageItems.length < requestCount) break;
  }

  return items;
};

const prepareSkin = async (
  item: SearchItem,
  rarity: string,
  floatCache: Map<string, SkinFloatRange | null>,
): Promise<PersistedSkin> => {
  const marketHashName = item.market_hash_name;
  const exterior = parseMarketHashExterior(marketHashName);
  const baseName = baseFromMarketHash(marketHashName);
  const marketName = item.market_name ?? item.name ?? marketHashName;
  const isStatTrak = detectStatTrak(marketName);
  const isSouvenir = detectSouvenir(marketName);

  let floatRange = floatCache.get(baseName);
  if (floatRange === undefined) {
    floatRange = await getSkinFloatRange(marketHashName);
    floatCache.set(baseName, floatRange ?? null);
  }

  return {
    marketHashName,
    marketName,
    baseName,
    exterior,
    rarity,
    weaponType: item.type ?? null,
    isStatTrak,
    isSouvenir,
    sellListings: item.sell_listings ?? 0,
    lastKnownPrice: item.price ?? null,
    classId: item.classid ?? null,
    instanceId: item.instanceid ?? null,
    iconUrl: item.icon_url ?? null,
    tradable: typeof item.tradable === "boolean" ? item.tradable : null,
    floatMin: floatRange?.minFloat ?? null,
    floatMax: floatRange?.maxFloat ?? null,
  };
};

const syncCollection = async (
  tag: SteamCollectionTag,
  progress: SyncJobProgress,
  floatCache: Map<string, SkinFloatRange | null>,
  updateProgress: () => Promise<void>,
): Promise<void> => {
  const allSkins: PersistedSkin[] = [];
  const allNames = new Set<string>();
  const baseNames = new Set<string>();

  for (const rarity of rarityOrder) {
    progress.currentRarity = rarity;
    await updateProgress();
    const items = await fetchEntireCollection(tag.tag, rarity);
    for (const item of items) {
      const prepared = await prepareSkin(item, rarity, floatCache);
      allSkins.push(prepared);
      allNames.add(prepared.marketHashName);
      baseNames.add(prepared.baseName);
    }
  }

  progress.currentRarity = undefined;
  await updateProgress();

  const guessedCollectionId = guessCollectionId(baseNames);
  const totalItems = allSkins.length;
  const normalCount = allSkins.filter((skin) => !skin.isSouvenir && !skin.isStatTrak).length;
  const normalizedName = tag.name.toLowerCase();
  const now = new Date();

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const collection = await tx.collection.upsert({
      where: { steamTag: tag.tag },
      create: {
        steamTag: tag.tag,
        name: tag.name,
        normalizedName,
        localCollectionId: guessedCollectionId,
        lastDiscoveredCount: tag.count,
        totalItems,
        normalItemCount: normalCount,
        lastSyncedAt: now,
      },
      update: {
        name: tag.name,
        normalizedName,
        localCollectionId: guessedCollectionId,
        lastDiscoveredCount: tag.count,
        totalItems,
        normalItemCount: normalCount,
        lastSyncedAt: now,
      },
      select: { id: true },
    });

    for (const skin of allSkins) {
      await tx.skin.upsert({
        where: { marketHashName: skin.marketHashName },
        create: {
          collectionId: collection.id,
          marketHashName: skin.marketHashName,
          marketName: skin.marketName,
          baseName: skin.baseName,
          exterior: skin.exterior,
          rarity: skin.rarity,
          weaponType: skin.weaponType,
          isStatTrak: skin.isStatTrak,
          isSouvenir: skin.isSouvenir,
          sellListings: skin.sellListings,
          lastKnownPrice: skin.lastKnownPrice,
          classId: skin.classId,
          instanceId: skin.instanceId,
          iconUrl: skin.iconUrl,
          tradable: skin.tradable,
          floatMin: skin.floatMin,
          floatMax: skin.floatMax,
        },
        update: {
          collectionId: collection.id,
          marketName: skin.marketName,
          baseName: skin.baseName,
          exterior: skin.exterior,
          rarity: skin.rarity,
          weaponType: skin.weaponType,
          isStatTrak: skin.isStatTrak,
          isSouvenir: skin.isSouvenir,
          sellListings: skin.sellListings,
          lastKnownPrice: skin.lastKnownPrice,
          classId: skin.classId,
          instanceId: skin.instanceId,
          iconUrl: skin.iconUrl,
          tradable: skin.tradable,
          floatMin: skin.floatMin,
          floatMax: skin.floatMax,
        },
      });
    }

    if (allNames.size) {
      await tx.skin.deleteMany({
        where: {
          collectionId: collection.id,
          marketHashName: { notIn: Array.from(allNames) },
        },
      });
    }
  });
};


const mapJobState = (state: JobState | "unknown"): SyncJobStatus["status"] => {
  if (state === "completed") return "completed";
  if (state === "failed") return "failed";
  if (state === "active") return "running";
  return "pending";
};

const normalizeProgress = (value: unknown): SyncJobProgress => {
  const base = initialProgress();
  if (!value || typeof value !== "object") {
    return base;
  }

  const progress = value as Partial<SyncJobProgress>;
  return {
    totalCollections:
      typeof progress.totalCollections === "number"
        ? progress.totalCollections
        : base.totalCollections,
    syncedCollections:
      typeof progress.syncedCollections === "number"
        ? progress.syncedCollections
        : base.syncedCollections,
    currentCollectionTag:
      typeof progress.currentCollectionTag === "string"
        ? progress.currentCollectionTag
        : undefined,
    currentCollectionName:
      typeof progress.currentCollectionName === "string"
        ? progress.currentCollectionName
        : undefined,
    currentRarity:
      typeof progress.currentRarity === "string" ? progress.currentRarity : undefined,
  };
};

const toSyncJobStatus = async (job: CatalogSyncJob): Promise<SyncJobStatus> => {
  const state = await job.getState().catch(() => "unknown" as const);
  const progress = normalizeProgress(job.progress);
  const startedAt = job.processedOn ?? job.timestamp ?? Date.now();

  return {
    id: String(job.id ?? ""),
    status: mapJobState(state),
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined,
    error: job.failedReason || undefined,
    progress,
  };
};

export const processCatalogSyncJob = async (job: CatalogSyncJob): Promise<void> => {
  const floatCache = new Map<string, SkinFloatRange | null>();
  const progress = initialProgress();

  const pushProgress = async () => {
    await job.updateProgress({ ...progress });
  };

  await pushProgress();

  const tags = await fetchCollectionTags();
  progress.totalCollections = tags.length;
  await pushProgress();

  for (const tag of tags) {
    progress.currentCollectionTag = tag.tag;
    progress.currentCollectionName = tag.name;
    await pushProgress();
    await syncCollection(tag, progress, floatCache, pushProgress);
    progress.syncedCollections += 1;
    await pushProgress();
  }

  progress.currentCollectionTag = undefined;
  progress.currentCollectionName = undefined;
  progress.currentRarity = undefined;
  await pushProgress();

  markCatalogReady();
};

const getExistingJob = async (): Promise<CatalogSyncJob | null> => {
  const [active] = await catalogSyncQueue.getJobs(["active"], 0, 0, false);
  if (active) return active;
  const [waiting] = await catalogSyncQueue.getJobs(["waiting", "delayed"], 0, 0, false);
  if (waiting) return waiting;
  return null;
};

export const requestFullCatalogSync = async (): Promise<SyncJobStatus> => {
  const existing = await getExistingJob();
  if (existing) {
    return toSyncJobStatus(existing);
  }

  const job = await catalogSyncQueue.add("full-catalog-sync", { triggeredBy: "manual" });
  return toSyncJobStatus(job);
};

export const getSyncJobStatus = async (id: string): Promise<SyncJobStatus | undefined> => {
  const job = await catalogSyncQueue.getJob(id);
  return job ? toSyncJobStatus(job) : undefined;
};

export const getActiveSyncJob = async (): Promise<SyncJobStatus | null> => {
  const [active] = await catalogSyncQueue.getJobs(["active"], 0, 0, false);
  if (!active) return null;
  return toSyncJobStatus(active);
};

export const listSyncJobs = async (): Promise<SyncJobStatus[]> => {
  const jobs = await catalogSyncQueue.getJobs(
    ["active", "waiting", "delayed", "completed", "failed"],
    0,
    20,
    false,
  );
  const statuses = await Promise.all(jobs.map((job) => toSyncJobStatus(job)));
  const unique = new Map(statuses.map((status) => [status.id, status]));
  return Array.from(unique.values()).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
};
