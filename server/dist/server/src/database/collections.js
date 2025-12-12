"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNamesByRarityFromDb = exports.getSkinsPageFromDb = exports.getRarityTotalsFromDb = exports.getCollectionInputsFromDb = exports.getCollectionTargetsFromDb = exports.getCollectionSummariesFromDb = void 0;
const client_1 = require("./client");
const service_1 = require("../modules/skins/service");
const normalizeRarity = (rarity) => rarity.trim();
const defaultSkinSelect = {
    marketHashName: true,
    baseName: true,
    exterior: true,
    lastKnownPrice: true,
    rarity: true,
    isSouvenir: true,
    isStatTrak: true,
    floatMin: true,
    floatMax: true,
};
const normalFilter = (normalOnly) => normalOnly
    ? { isSouvenir: false, isStatTrak: false }
    : {};
const getCollectionSummariesFromDb = async () => {
    try {
        const collections = await client_1.prisma.collection.findMany({
            orderBy: { name: "asc" },
        });
        if (!collections.length)
            return null;
        return collections.map((collection) => ({
            tag: collection.steamTag,
            name: collection.name,
            count: collection.normalItemCount || collection.totalItems,
            collectionId: collection.localCollectionId ?? null,
        }));
    }
    catch (error) {
        return null;
    }
};
exports.getCollectionSummariesFromDb = getCollectionSummariesFromDb;
const buildTargets = (entries) => {
    const grouped = new Map();
    for (const entry of entries) {
        const baseName = entry.baseName || (0, service_1.baseFromMarketHash)(entry.marketHashName);
        const summary = grouped.get(baseName) ?? {
            baseName,
            exteriors: [],
        };
        summary.exteriors.push({
            exterior: entry.exterior,
            marketHashName: entry.marketHashName,
            price: entry.lastKnownPrice,
            minFloat: entry.floatMin ?? undefined,
            maxFloat: entry.floatMax ?? undefined,
        });
        grouped.set(baseName, summary);
    }
    return Array.from(grouped.values()).sort((a, b) => a.baseName.localeCompare(b.baseName));
};
const getCollectionTargetsFromDb = async (collectionTag, rarity) => {
    try {
        const collection = await client_1.prisma.collection.findUnique({
            where: { steamTag: collectionTag },
            select: {
                id: true,
                localCollectionId: true,
                steamTag: true,
                skins: {
                    where: {
                        rarity,
                        isSouvenir: false,
                        isStatTrak: false,
                    },
                    orderBy: { marketHashName: "asc" },
                    select: defaultSkinSelect,
                },
            },
        });
        if (!collection)
            return null;
        const skins = collection.skins;
        const targets = buildTargets(skins.map((skin) => ({
            baseName: skin.baseName,
            marketHashName: skin.marketHashName,
            exterior: skin.exterior,
            lastKnownPrice: skin.lastKnownPrice,
            floatMin: skin.floatMin,
            floatMax: skin.floatMax,
        })));
        return {
            collectionTag,
            collectionId: collection.localCollectionId ?? null,
            rarity,
            targets,
        };
    }
    catch (error) {
        return null;
    }
};
exports.getCollectionTargetsFromDb = getCollectionTargetsFromDb;
const getCollectionInputsFromDb = async (collectionTag, inputRarity) => {
    try {
        const collection = await client_1.prisma.collection.findUnique({
            where: { steamTag: collectionTag },
            select: {
                id: true,
                localCollectionId: true,
                skins: {
                    where: {
                        rarity: inputRarity,
                        isSouvenir: false,
                        isStatTrak: false,
                    },
                    orderBy: { marketHashName: "asc" },
                    select: defaultSkinSelect,
                },
            },
        });
        if (!collection)
            return null;
        const skins = collection.skins;
        const inputs = skins.map((skin) => ({
            baseName: skin.baseName,
            marketHashName: skin.marketHashName,
            exterior: skin.exterior,
            price: skin.lastKnownPrice,
        }));
        return {
            collectionTag,
            collectionId: collection.localCollectionId ?? null,
            rarity: inputRarity,
            inputs,
        };
    }
    catch (error) {
        return null;
    }
};
exports.getCollectionInputsFromDb = getCollectionInputsFromDb;
const getRarityTotalsFromDb = async (rarities, normalOnly) => {
    try {
        const result = await client_1.prisma.skin.groupBy({
            by: ["rarity"],
            where: {
                rarity: { in: rarities.map(normalizeRarity) },
                ...normalFilter(normalOnly),
            },
            _count: { _all: true },
        });
        if (!result.length)
            return null;
        const perRarity = {};
        let sum = 0;
        for (const entry of result) {
            const rarity = entry.rarity;
            const count = entry._count._all;
            perRarity[rarity] = count;
            sum += count;
        }
        return { perRarity, sum };
    }
    catch (error) {
        return null;
    }
};
exports.getRarityTotalsFromDb = getRarityTotalsFromDb;
const getSkinsPageFromDb = async (rarity, start, count, normalOnly) => {
    try {
        const where = {
            rarity: normalizeRarity(rarity),
            ...normalFilter(normalOnly),
        };
        const [total, skins] = await client_1.prisma.$transaction([
            client_1.prisma.skin.count({ where }),
            client_1.prisma.skin.findMany({
                where,
                orderBy: { marketHashName: "asc" },
                skip: start,
                take: count,
                select: {
                    marketHashName: true,
                    sellListings: true,
                    lastKnownPrice: true,
                },
            }),
        ]);
        const summaryRows = skins;
        const items = summaryRows.map((skin) => ({
            market_hash_name: skin.marketHashName,
            sell_listings: skin.sellListings,
            price: skin.lastKnownPrice ?? null,
        }));
        return { total, items };
    }
    catch (error) {
        return null;
    }
};
exports.getSkinsPageFromDb = getSkinsPageFromDb;
const getNamesByRarityFromDb = async (rarity, normalOnly) => {
    try {
        const skins = await client_1.prisma.skin.findMany({
            where: {
                rarity: normalizeRarity(rarity),
                ...normalFilter(normalOnly),
            },
            orderBy: { marketHashName: "asc" },
            select: { marketHashName: true },
        });
        if (!skins.length)
            return [];
        return skins.map((skin) => skin.marketHashName);
    }
    catch (error) {
        return null;
    }
};
exports.getNamesByRarityFromDb = getNamesByRarityFromDb;
