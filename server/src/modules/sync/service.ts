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
import { ensureDatabaseConnection, hasDatabaseConnection } from "../../database/env";
import { markCatalogReady } from "../../database/status";
import { COLLECTIONS_WITH_FLOAT } from "../../../../data/CollectionsWithFloat";

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

export interface CatalogSyncJobData {
  triggeredBy?: "manual" | "schedule";
}

type CatalogSyncJobRecord = Prisma.CatalogSyncJobGetPayload<true>;

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


const normalizeProgress = (value: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined): SyncJobProgress => {
  const base = initialProgress();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

const toSyncJobStatus = (job: CatalogSyncJobRecord): SyncJobStatus => {
  const progress = normalizeProgress(job.progress);

  return {
    id: job.id,
    status: job.status as SyncJobStatus["status"],
    startedAt: (job.startedAt ?? job.createdAt).toISOString(),
    finishedAt: job.finishedAt?.toISOString(),
    error: job.error ?? undefined,
    progress,
  };
};

const serializeJobPayload = (data: CatalogSyncJobData): Prisma.InputJsonValue => {
  const payload: Prisma.JsonObject = {};
  if (data.triggeredBy) {
    payload.triggeredBy = data.triggeredBy;
  }
  return payload;
};

const toJsonProgress = (value: SyncJobProgress): Prisma.InputJsonValue => {
  const payload: Prisma.JsonObject = {
    totalCollections: value.totalCollections,
    syncedCollections: value.syncedCollections,
  };
  if (value.currentCollectionTag !== undefined) payload.currentCollectionTag = value.currentCollectionTag;
  if (value.currentCollectionName !== undefined) payload.currentCollectionName = value.currentCollectionName;
  if (value.currentRarity !== undefined) payload.currentRarity = value.currentRarity;
  return payload;
};

const parseJobPayload = (value: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined): CatalogSyncJobData => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const payload = value as { triggeredBy?: unknown };
  const triggeredBy = payload.triggeredBy;
  return {
    triggeredBy:
      triggeredBy === "manual" || triggeredBy === "schedule"
        ? (triggeredBy as "manual" | "schedule")
        : undefined,
  };
};

const toErrorString = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

let activeJobId: string | null = null;

const runCatalogSyncJob = async (jobId: string, payload: CatalogSyncJobData): Promise<void> => {
  const floatCache = new Map<string, SkinFloatRange | null>();
  const progress = initialProgress();

  const pushProgress = async () => {
    await prisma.catalogSyncJob.update({
      where: { id: jobId },
      data: { progress: toJsonProgress(progress) },
    });
  };

  await prisma.catalogSyncJob.update({
    where: { id: jobId },
    data: {
      status: "running",
      startedAt: new Date(),
      finishedAt: null,
      error: null,
      progress: toJsonProgress(progress),
      payload: serializeJobPayload(payload),
    },
  });

  await pushProgress();

  try {
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

    await prisma.catalogSyncJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        finishedAt: new Date(),
        progress: toJsonProgress(progress),
      },
    });

    markCatalogReady();
  } catch (error) {
    await prisma.catalogSyncJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: toErrorString(error),
        progress: toJsonProgress(progress),
      },
    });

    throw error;
  }
};

const startCatalogSyncJob = (jobId: string, payload: CatalogSyncJobData) => {
  if (activeJobId === jobId) {
    return;
  }

  activeJobId = jobId;

  void runCatalogSyncJob(jobId, payload)
    .catch((error) => {
      console.error("Catalog sync job failed", { jobId, error });
    })
    .finally(() => {
      if (activeJobId === jobId) {
        activeJobId = null;
      }
    });
};

const ensureJobStarted = (job: CatalogSyncJobRecord | null | undefined) => {
  if (!job) return;
  if (job.status !== "pending" && job.status !== "running") return;
  if (activeJobId === job.id) return;
  startCatalogSyncJob(job.id, parseJobPayload(job.payload));
};

const findLatestActiveJob = async (): Promise<CatalogSyncJobRecord | null> =>
  prisma.catalogSyncJob.findFirst({
    where: { status: { in: ["pending", "running"] } },
    orderBy: { createdAt: "desc" },
  });

const resumeInterruptedJob = async () => {
  if (!hasDatabaseConnection()) {
    console.warn("Skipping catalog sync job resume because DATABASE_URL is not set.");
    return;
  }

  const latest = await findLatestActiveJob();
  if (!latest) return;

  if (latest.status === "running") {
    const reset = await prisma.catalogSyncJob.update({
      where: { id: latest.id },
      data: {
        status: "pending",
        startedAt: null,
        finishedAt: null,
        error: "Job was restarted after interruption",
        progress: toJsonProgress(initialProgress()),
      },
    });
    ensureJobStarted(reset);
    return;
  }

  ensureJobStarted(latest);
};

void resumeInterruptedJob().catch((error) => {
  console.error("Failed to resume catalog sync job", error);
});

export const requestFullCatalogSync = async (): Promise<SyncJobStatus> => {
  ensureDatabaseConnection();

  const existing = await findLatestActiveJob();
  if (existing) {
    ensureJobStarted(existing);
    return toSyncJobStatus(existing);
  }

  const payload: CatalogSyncJobData = { triggeredBy: "manual" };

  const job = await prisma.catalogSyncJob.create({
    data: {
      status: "pending",
      triggeredBy: payload.triggeredBy ?? null,
      progress: toJsonProgress(initialProgress()),
      payload: serializeJobPayload(payload),
    },
  });

  ensureJobStarted(job);

  return toSyncJobStatus(job);
};

export const getSyncJobStatus = async (id: string): Promise<SyncJobStatus | undefined> => {
  ensureDatabaseConnection();

  const job = await prisma.catalogSyncJob.findUnique({ where: { id } });
  if (!job) return undefined;
  ensureJobStarted(job);
  return toSyncJobStatus(job);
};

export const getActiveSyncJob = async (): Promise<SyncJobStatus | null> => {
  ensureDatabaseConnection();

  const job = await findLatestActiveJob();
  if (!job) return null;
  ensureJobStarted(job);
  return toSyncJobStatus(job);
};

export const listSyncJobs = async (): Promise<SyncJobStatus[]> => {
  ensureDatabaseConnection();

  const jobs = await prisma.catalogSyncJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  ensureJobStarted(jobs.find((job) => job.status === "pending" || job.status === "running"));

  return jobs.map((job) => toSyncJobStatus(job));
};
