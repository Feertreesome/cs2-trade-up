"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listSyncJobs = exports.getActiveSyncJob = exports.getSyncJobStatus = exports.requestFullCatalogSync = exports.processCatalogSyncJob = exports.catalogSyncQueue = void 0;
const bullmq_1 = require("bullmq");
const repo_1 = require("../steam/repo");
const config_1 = require("../../config");
const service_1 = require("../skins/service");
const floatRanges_1 = require("../tradeups/floatRanges");
const client_1 = require("../../database/client");
const status_1 = require("../../database/status");
const CollectionsWithFloat_1 = require("../../../../data/CollectionsWithFloat");
const connection_1 = require("../../queues/connection");
const queueName = process.env.CATALOG_SYNC_QUEUE ?? "catalog-sync";
const QUEUE_RATE_LIMIT = {
    max: 1,
    duration: 1100,
};
exports.catalogSyncQueue = new bullmq_1.Queue(queueName, {
    connection: connection_1.redisConnection,
    defaultJobOptions: {
        attempts: 8,
        backoff: {
            type: "exponential",
            delay: 2000,
        },
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
void exports.catalogSyncQueue
    .waitUntilReady()
    .then(() => exports.catalogSyncQueue.setGlobalRateLimit(QUEUE_RATE_LIMIT.max, QUEUE_RATE_LIMIT.duration))
    .catch((error) => {
    console.error("Failed to set catalog sync queue rate limit", error);
});
const rarityOrder = Object.keys(repo_1.RARITY_TO_TAG);
const initialProgress = () => ({
    totalCollections: 0,
    syncedCollections: 0,
});
const detectStatTrak = (marketName) => /StatTrak/i.test(marketName);
const detectSouvenir = (marketName) => /^Souvenir /i.test(marketName);
const guessCollectionId = (baseNames) => {
    for (const entry of CollectionsWithFloat_1.COLLECTIONS_WITH_FLOAT) {
        const hasMatch = entry.covert.some((covert) => baseNames.has(covert.baseName)) ||
            entry.classified.some((classified) => baseNames.has(classified.baseName));
        if (hasMatch)
            return entry.id;
    }
    return null;
};
const fetchEntireCollection = async (collectionTag, rarity) => {
    const items = [];
    let start = 0;
    while (true) {
        const remaining = config_1.STEAM_MAX_AUTO_LIMIT - start;
        if (remaining <= 0)
            break;
        const requestCount = Math.min(config_1.STEAM_PAGE_SIZE, remaining);
        const { items: pageItems, total: totalCount } = await (0, repo_1.searchByCollection)({
            collectionTag,
            rarity,
            start,
            count: requestCount,
            normalOnly: true,
        });
        if (!pageItems.length)
            break;
        items.push(...pageItems);
        start += pageItems.length;
        if (start >= totalCount || start >= config_1.STEAM_MAX_AUTO_LIMIT)
            break;
        if (pageItems.length < requestCount)
            break;
    }
    return items;
};
const prepareSkin = async (item, rarity, floatCache) => {
    const marketHashName = item.market_hash_name;
    const exterior = (0, service_1.parseMarketHashExterior)(marketHashName);
    const baseName = (0, service_1.baseFromMarketHash)(marketHashName);
    const marketName = item.market_name ?? item.name ?? marketHashName;
    const isStatTrak = detectStatTrak(marketName);
    const isSouvenir = detectSouvenir(marketName);
    let floatRange = floatCache.get(baseName);
    if (floatRange === undefined) {
        floatRange = await (0, floatRanges_1.getSkinFloatRange)(marketHashName);
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
const syncCollection = async (tag, progress, floatCache, updateProgress) => {
    const allSkins = [];
    const allNames = new Set();
    const baseNames = new Set();
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
    await client_1.prisma.$transaction(async (tx) => {
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
const mapJobState = (state) => {
    if (state === "completed")
        return "completed";
    if (state === "failed")
        return "failed";
    if (state === "active")
        return "running";
    return "pending";
};
const normalizeProgress = (value) => {
    const base = initialProgress();
    if (!value || typeof value !== "object") {
        return base;
    }
    const progress = value;
    return {
        totalCollections: typeof progress.totalCollections === "number"
            ? progress.totalCollections
            : base.totalCollections,
        syncedCollections: typeof progress.syncedCollections === "number"
            ? progress.syncedCollections
            : base.syncedCollections,
        currentCollectionTag: typeof progress.currentCollectionTag === "string"
            ? progress.currentCollectionTag
            : undefined,
        currentCollectionName: typeof progress.currentCollectionName === "string"
            ? progress.currentCollectionName
            : undefined,
        currentRarity: typeof progress.currentRarity === "string" ? progress.currentRarity : undefined,
    };
};
const toSyncJobStatus = async (job) => {
    const state = await job.getState().catch(() => "unknown");
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
const processCatalogSyncJob = async (job) => {
    const floatCache = new Map();
    const progress = initialProgress();
    const pushProgress = async () => {
        await job.updateProgress({ ...progress });
    };
    await pushProgress();
    const tags = await (0, repo_1.fetchCollectionTags)();
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
    (0, status_1.markCatalogReady)();
};
exports.processCatalogSyncJob = processCatalogSyncJob;
const getExistingJob = async () => {
    const [active] = await exports.catalogSyncQueue.getJobs(["active"], 0, 0, false);
    if (active)
        return active;
    const [waiting] = await exports.catalogSyncQueue.getJobs(["waiting", "delayed"], 0, 0, false);
    if (waiting)
        return waiting;
    return null;
};
const requestFullCatalogSync = async () => {
    const existing = await getExistingJob();
    if (existing) {
        return toSyncJobStatus(existing);
    }
    const job = await exports.catalogSyncQueue.add("full-catalog-sync", { triggeredBy: "manual" });
    return toSyncJobStatus(job);
};
exports.requestFullCatalogSync = requestFullCatalogSync;
const getSyncJobStatus = async (id) => {
    const job = await exports.catalogSyncQueue.getJob(id);
    return job ? toSyncJobStatus(job) : undefined;
};
exports.getSyncJobStatus = getSyncJobStatus;
const getActiveSyncJob = async () => {
    const [active] = await exports.catalogSyncQueue.getJobs(["active"], 0, 0, false);
    if (!active)
        return null;
    return toSyncJobStatus(active);
};
exports.getActiveSyncJob = getActiveSyncJob;
const listSyncJobs = async () => {
    const jobs = await exports.catalogSyncQueue.getJobs(["active", "waiting", "delayed", "completed", "failed"], 0, 20, false);
    const statuses = await Promise.all(jobs.map((job) => toSyncJobStatus(job)));
    const unique = new Map(statuses.map((status) => [status.id, status]));
    return Array.from(unique.values()).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
};
exports.listSyncJobs = listSyncJobs;
