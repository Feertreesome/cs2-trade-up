"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkTradeupAvailability = exports.calculateTradeup = exports.fetchCollectionInputs = exports.fetchCollectionTargets = exports.fetchSteamCollections = exports.warmTradeupCatalog = exports.resetTradeupCaches = exports.getCollectionsCatalog = void 0;
/**
 * Модуль бизнес-логики trade-up калькулятора. Содержит функции, которые
 * переиспользуются в HTTP-роутере и в клиентском приложении через API.
 * Здесь же реализованы вспомогательные структуры и кеши для сопоставления
 * коллекций Steam с нашим справочником float-диапазонов.
 */
const axios_1 = __importDefault(require("axios"));
const collectionFloatData = __importStar(require("../../../../data/CollectionsWithFloat"));
const config_1 = require("../../config");
const repo_1 = require("../steam/repo");
const service_1 = require("../skins/service");
const floatRanges_1 = require("./floatRanges");
const collections_1 = require("../../database/collections");
const status_1 = require("../../database/status");
const { COLLECTIONS_WITH_FLOAT, COLLECTIONS_WITH_FLOAT_MAP, COLLECTIONS_WITH_FLOAT_BY_NAME, COVERT_FLOAT_BY_BASENAME, CLASSIFIED_FLOAT_BY_BASENAME, rebuildCollectionFloatCaches, } = collectionFloatData;
const DEFAULT_BUYER_TO_NET = 1.15;
const WEAR_BUCKETS = [
    { exterior: "Factory New", min: 0, max: 0.06999999999999999 },
    { exterior: "Minimal Wear", min: 0.07, max: 0.14999999999999999 },
    { exterior: "Field-Tested", min: 0.15, max: 0.37999999999999999 },
    { exterior: "Well-Worn", min: 0.38, max: 0.44999999999999999 },
    { exterior: "Battle-Scarred", min: 0.45, max: 1 },
];
/** Ограничивает значение указанным диапазоном. */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const isWithinBucket = (value, bucket, inclusiveMax, tolerance = Number.EPSILON) => {
    const aboveMin = value >= bucket.min || Math.abs(value - bucket.min) <= tolerance;
    if (!aboveMin) {
        return false;
    }
    if (inclusiveMax) {
        return value <= bucket.max || Math.abs(value - bucket.max) <= tolerance;
    }
    if (value < bucket.max) {
        return true;
    }
    if (Math.abs(value - bucket.max) <= tolerance) {
        return false;
    }
    return value < bucket.max;
};
/** Возвращает наименование степени износа, соответствующее float-значению. */
const getExteriorByFloat = (float) => {
    const bucket = WEAR_BUCKETS.find((entry, index) => isWithinBucket(float, entry, index === WEAR_BUCKETS.length - 1));
    return bucket?.exterior ?? WEAR_BUCKETS[WEAR_BUCKETS.length - 1].exterior;
};
/** Находит числовой диапазон wear-ступени. */
const getWearRange = (exterior) => WEAR_BUCKETS.find((entry) => entry.exterior === exterior) ?? WEAR_BUCKETS[WEAR_BUCKETS.length - 1];
/** Собирает market_hash_name из базового названия и износа. */
const toMarketHashName = (baseName, exterior) => `${baseName} (${exterior})`;
/**
 * Собирает подробности по одному потенциальному исходу trade-up'а и подтягивает цену из Steam.
 */
const buildOutcome = async (options) => {
    const { inputAverageFloat, collection, entry, collectionProbability, rangeCount, buyerToNetRate, override, } = options;
    const minFloat = override?.minFloat ?? entry.minFloat;
    const maxFloat = override?.maxFloat ?? entry.maxFloat;
    // В игре trade-up использует средний float входов (InputFloat) и линейно
    // преобразует его в диапазон результата: OutputFloat = (Maxout - Minout) * InputFloat + Minout.
    const raw = inputAverageFloat * (maxFloat - minFloat) + minFloat;
    const rollFloat = clamp(raw, minFloat, maxFloat);
    const exterior = override?.exterior ?? getExteriorByFloat(rollFloat);
    const wearRange = getWearRange(exterior);
    const marketHashName = override?.marketHashName ?? toMarketHashName(entry.baseName, exterior);
    let buyerPrice = override?.price ?? null;
    let priceError = undefined;
    if (buyerPrice == null) {
        const { price, error } = await (0, repo_1.getPriceUSD)(marketHashName);
        buyerPrice = price;
        priceError = error;
    }
    const netPrice = buyerPrice == null ? null : buyerPrice / buyerToNetRate;
    const probability = rangeCount > 0 ? collectionProbability / rangeCount : 0;
    return {
        collectionId: collection.id,
        collectionName: collection.name,
        baseName: entry.baseName,
        minFloat,
        maxFloat,
        rollFloat,
        exterior,
        wearRange: { min: wearRange.min, max: wearRange.max },
        probability,
        buyerPrice,
        netPrice,
        priceError,
        marketHashName,
        withinRange: rollFloat >= minFloat && rollFloat <= maxFloat,
    };
};
/**
 * Обогащает входные слоты ценой: либо из пользовательского ввода, либо из Steam через API.
 */
const enrichInput = async (input, buyerToNetRate) => {
    if (input.priceOverrideNet != null) {
        return {
            ...input,
            priceMarket: input.priceOverrideNet * buyerToNetRate,
            netPrice: input.priceOverrideNet,
        };
    }
    const { price, error } = await (0, repo_1.getPriceUSD)(input.marketHashName);
    const netPrice = price == null ? null : price / buyerToNetRate;
    return {
        ...input,
        priceMarket: price,
        netPrice,
        priceError: error,
    };
};
let collectionCachesReady = false;
const ensureCollectionCaches = () => {
    if (!collectionCachesReady) {
        rebuildCollectionFloatCaches();
        collectionCachesReady = true;
    }
};
/** Возвращает локальный справочник коллекций и их float-диапазонов. */
const getCollectionsCatalog = () => {
    ensureCollectionCaches();
    return COLLECTIONS_WITH_FLOAT.slice();
};
exports.getCollectionsCatalog = getCollectionsCatalog;
const STEAM_TAG_TO_COLLECTION_ID = new Map();
const resetTradeupCaches = () => {
    collectionCachesReady = false;
    STEAM_TAG_TO_COLLECTION_ID.clear();
};
exports.resetTradeupCaches = resetTradeupCaches;
const warmTradeupCatalog = () => {
    (0, exports.resetTradeupCaches)();
    ensureCollectionCaches();
};
exports.warmTradeupCatalog = warmTradeupCatalog;
const rememberCollectionId = (tag, collectionId) => {
    STEAM_TAG_TO_COLLECTION_ID.set(tag, collectionId);
    return collectionId;
};
const findCollectionIdByTag = (tag) => {
    if (STEAM_TAG_TO_COLLECTION_ID.has(tag)) {
        return STEAM_TAG_TO_COLLECTION_ID.get(tag) ?? null;
    }
    return null;
};
const guessCollectionIdByBaseNames = (baseNames) => {
    ensureCollectionCaches();
    for (const entry of COLLECTIONS_WITH_FLOAT) {
        const hasMatch = entry.covert.some((covert) => baseNames.includes(covert.baseName)) ||
            entry.classified.some((classified) => baseNames.includes(classified.baseName));
        if (hasMatch) {
            return entry.id;
        }
    }
    return null;
};
const fetchSteamCollections = async () => {
    ensureCollectionCaches();
    if (await (0, status_1.isCatalogReady)()) {
        try {
            const stored = await (0, collections_1.getCollectionSummariesFromDb)();
            if (stored && stored.length) {
                return stored.map((entry) => {
                    rememberCollectionId(entry.tag, entry.collectionId);
                    return entry;
                });
            }
        }
        catch (error) {
            // Ignore and fall back to Steam
        }
    }
    const tags = await (0, repo_1.fetchCollectionTags)();
    return tags.map((tag) => {
        const collection = COLLECTIONS_WITH_FLOAT_BY_NAME.get(tag.name.toLowerCase());
        const collectionId = rememberCollectionId(tag.tag, collection?.id ?? null);
        return { tag: tag.tag, name: tag.name, count: tag.count, collectionId };
    });
};
exports.fetchSteamCollections = fetchSteamCollections;
/**
 * Выгружает страницу за страницей весь список предметов конкретной коллекции.
 */
const fetchEntireCollection = async (options) => {
    const pageSize = config_1.STEAM_PAGE_SIZE;
    const hardLimit = config_1.STEAM_MAX_AUTO_LIMIT;
    const items = [];
    let start = 0;
    let total = 0;
    while (true) {
        const remaining = hardLimit - start;
        if (remaining <= 0)
            break;
        const requestCount = Math.min(pageSize, remaining);
        const { items: pageItems, total: totalCount } = await (0, repo_1.searchByCollection)({
            collectionTag: options.collectionTag,
            rarity: options.rarity,
            start,
            count: requestCount,
            normalOnly: true,
        });
        if (!items.length)
            total = totalCount;
        if (!pageItems.length)
            break;
        items.push(...pageItems);
        start += pageItems.length;
        if (start >= totalCount || start >= hardLimit || pageItems.length < requestCount)
            break;
        if (start >= Math.min(hardLimit, 600))
            break; // safety guard against runaway pagination
    }
    return items;
};
/**
 * Загружает Covert-предметы коллекции, группирует их по базовому названию и дополняет float-диапазоном.
 */
const fetchCollectionTargets = async (collectionTag, rarity = "Covert") => {
    ensureCollectionCaches();
    let persisted = null;
    if (await (0, status_1.isCatalogReady)()) {
        try {
            persisted = await (0, collections_1.getCollectionTargetsFromDb)(collectionTag, rarity);
            if (persisted && persisted.targets.length) {
                if (persisted.collectionId) {
                    rememberCollectionId(collectionTag, persisted.collectionId);
                }
                return persisted;
            }
        }
        catch (error) {
            // Ignore and fall back to Steam
        }
    }
    const items = await fetchEntireCollection({ collectionTag, rarity });
    const grouped = new Map();
    const baseNames = [];
    const floatCache = new Map();
    const predefinedFloats = rarity === "Classified" ? CLASSIFIED_FLOAT_BY_BASENAME : COVERT_FLOAT_BY_BASENAME;
    for (const item of items) {
        const exterior = (0, service_1.parseMarketHashExterior)(item.market_hash_name);
        const baseName = (0, service_1.baseFromMarketHash)(item.market_hash_name);
        let floats = predefinedFloats.get(baseName);
        if (!floats) {
            if (!floatCache.has(baseName)) {
                const range = await (0, floatRanges_1.getSkinFloatRange)(item.market_hash_name);
                const normalized = range
                    ? { baseName, minFloat: range.minFloat, maxFloat: range.maxFloat }
                    : undefined;
                floatCache.set(baseName, normalized);
            }
            floats = floatCache.get(baseName);
        }
        let entry = grouped.get(baseName);
        if (!entry) {
            entry = { baseName, exteriors: [] };
            grouped.set(baseName, entry);
            baseNames.push(baseName);
        }
        entry.exteriors.push({
            exterior,
            marketHashName: item.market_hash_name,
            price: item.price,
            minFloat: floats?.minFloat,
            maxFloat: floats?.maxFloat,
        });
    }
    let collectionId = persisted?.collectionId ?? findCollectionIdByTag(collectionTag);
    if (collectionId == null) {
        collectionId = rememberCollectionId(collectionTag, guessCollectionIdByBaseNames(baseNames));
    }
    return {
        collectionTag,
        collectionId,
        rarity,
        targets: Array.from(grouped.values()),
    };
};
exports.fetchCollectionTargets = fetchCollectionTargets;
/**
 * Получает список предметов коллекции, которые могут служить входами для trade-up'а.
 */
const fetchCollectionInputs = async (collectionTag, targetRarity = "Covert") => {
    ensureCollectionCaches();
    const inputRarity = targetRarity === "Classified" ? "Restricted" : "Classified";
    let persisted = null;
    if (await (0, status_1.isCatalogReady)()) {
        try {
            persisted = await (0, collections_1.getCollectionInputsFromDb)(collectionTag, inputRarity);
            if (persisted && persisted.inputs.length) {
                if (persisted.collectionId) {
                    rememberCollectionId(collectionTag, persisted.collectionId);
                }
                return persisted;
            }
        }
        catch (error) {
            // Ignore and fall back to Steam
        }
    }
    const items = await fetchEntireCollection({
        collectionTag,
        rarity: inputRarity,
    });
    const inputs = items.map((item) => ({
        baseName: (0, service_1.baseFromMarketHash)(item.market_hash_name),
        marketHashName: item.market_hash_name,
        exterior: (0, service_1.parseMarketHashExterior)(item.market_hash_name),
        price: item.price,
    }));
    let collectionId = persisted?.collectionId ?? findCollectionIdByTag(collectionTag);
    if (collectionId == null && inputs.length) {
        collectionId = rememberCollectionId(collectionTag, guessCollectionIdByBaseNames(inputs.map((input) => input.baseName)));
    }
    return { collectionTag, collectionId, rarity: inputRarity, inputs };
};
exports.fetchCollectionInputs = fetchCollectionInputs;
/**
 * Основной расчёт: принимает 10 входов, список целевых коллекций и возвращает распределение исходов.
 */
const calculateTradeup = async (payload) => {
    ensureCollectionCaches();
    if (!payload?.inputs?.length) {
        throw new Error("At least one input is required");
    }
    const buyerToNetRate = payload.options?.buyerToNetRate && payload.options.buyerToNetRate > 1
        ? payload.options.buyerToNetRate
        : DEFAULT_BUYER_TO_NET;
    const inputs = payload.inputs.map((slot) => ({
        ...slot,
        float: clamp(slot.float, 0, 1),
    }));
    const totalInputs = inputs.length;
    const averageFloat = inputs.reduce((sum, slot) => sum + slot.float, 0) / totalInputs;
    const normalizedValues = await Promise.all(inputs.map(async (slot) => {
        const min = typeof slot.minFloat === "number" ? slot.minFloat : null;
        const max = typeof slot.maxFloat === "number" ? slot.maxFloat : null;
        let rangeMin = min;
        let rangeMax = max;
        if (rangeMin == null || rangeMax == null || rangeMax <= rangeMin) {
            const range = await (0, floatRanges_1.getSkinFloatRange)(slot.marketHashName);
            if (range) {
                rangeMin = range.minFloat;
                rangeMax = range.maxFloat;
            }
        }
        if (rangeMin == null || rangeMax == null || rangeMax <= rangeMin) {
            return null;
        }
        const normalized = (slot.float - rangeMin) / (rangeMax - rangeMin);
        return clamp(normalized, 0, 1);
    }));
    const canUseNormalized = normalizedValues.every((value) => value != null);
    const normalizedAverageFloat = canUseNormalized
        ? normalizedValues.reduce((sum, value) => sum + (value ?? 0), 0) / Math.max(totalInputs, 1)
        : averageFloat;
    const collectionCounts = new Map();
    for (const slot of inputs) {
        collectionCounts.set(slot.collectionId, (collectionCounts.get(slot.collectionId) ?? 0) + 1);
    }
    const overridesByCollection = new Map();
    for (const override of payload.targetOverrides ?? []) {
        if (!override?.baseName)
            continue;
        let collectionId = override.collectionId ?? null;
        if (!collectionId && override.collectionTag) {
            collectionId = findCollectionIdByTag(override.collectionTag);
        }
        if (!collectionId)
            continue;
        const key = `${collectionId}:${override.baseName.toLowerCase()}`;
        if (!overridesByCollection.has(key)) {
            overridesByCollection.set(key, { ...override, collectionId });
        }
    }
    const targetRarity = payload.targetRarity === "Classified" ? "Classified" : "Covert";
    const targetCollections = payload.targetCollectionIds
        .map((id) => COLLECTIONS_WITH_FLOAT_MAP.get(id))
        .filter((collection) => Boolean(collection));
    if (!targetCollections.length) {
        throw new Error("No valid target collections specified");
    }
    const outcomes = await Promise.all(targetCollections.flatMap((collection) => {
        const collectionProbability = (collectionCounts.get(collection.id) ?? 0) / totalInputs;
        const candidates = targetRarity === "Classified" ? collection.classified : collection.covert;
        const rangeCount = candidates.length;
        if (!rangeCount) {
            return [];
        }
        return candidates.map((entry) => buildOutcome({
            inputAverageFloat: averageFloat,
            collection,
            entry,
            collectionProbability,
            rangeCount,
            buyerToNetRate,
            override: overridesByCollection.get(`${collection.id}:${entry.baseName.toLowerCase()}`),
        }));
    }));
    const inputSummaries = await Promise.all(inputs.map((slot) => enrichInput(slot, buyerToNetRate)));
    const totalInputNet = inputSummaries.reduce((sum, slot) => sum + (slot.netPrice ?? 0), 0);
    const totalOutcomeNet = outcomes.reduce((sum, outcome) => sum + outcome.probability * (outcome.netPrice ?? 0), 0);
    const expectedValue = totalOutcomeNet - totalInputNet;
    const maxBudgetPerSlot = totalInputs ? totalOutcomeNet / totalInputs : 0;
    const positiveOutcomeProbability = outcomes.reduce((sum, outcome) => {
        if (outcome.netPrice != null && outcome.netPrice > totalInputNet) {
            return sum + outcome.probability;
        }
        return sum;
    }, 0);
    const warnings = [];
    if (!canUseNormalized) {
        warnings.push("Не удалось получить точные диапазоны float для всех входов — используется упрощённое среднее.");
    }
    for (const outcome of outcomes) {
        if (!outcome.withinRange) {
            warnings.push(`${outcome.baseName} roll float ${outcome.rollFloat.toFixed(4)} is outside declared range`);
        }
    }
    return {
        averageFloat,
        normalizedAverageFloat,
        normalizationMode: canUseNormalized ? "normalized" : "simple",
        inputs: inputSummaries,
        outcomes,
        totalInputNet,
        totalOutcomeNet,
        expectedValue,
        maxBudgetPerSlot,
        positiveOutcomeProbability,
        warnings,
    };
};
exports.calculateTradeup = calculateTradeup;
const STEAM_APP_ID = 730;
const STEAM_LISTING_PAGE_SIZE = 10;
const MAX_LISTINGS_PER_ITEM = 50;
const FLOAT_REQUEST_INTERVAL_MS = 1500;
const FLOAT_API_ENDPOINT = "https://api.csgofloat.com/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const buildListingUrl = (marketHashName, start, count) => {
    const params = new URLSearchParams({
        start: String(Math.max(0, start)),
        count: String(Math.max(1, Math.min(STEAM_LISTING_PAGE_SIZE, count))),
        currency: "1",
        language: "english",
        format: "json",
        country: "US",
    });
    return `https://steamcommunity.com/market/listings/${STEAM_APP_ID}/${encodeURIComponent(marketHashName)}/render?${params.toString()}`;
};
const resolveInspectLink = (listingId, info, asset) => {
    const actions = asset?.market_actions ??
        asset?.actions ??
        info.asset?.market_actions ??
        info.asset?.actions ??
        [];
    const template = actions[0]?.link;
    if (!template)
        return null;
    const assetId = asset?.id ?? info.asset?.id ?? info.asset?.assetid ?? "";
    const owner = info.steamid_lister ?? info.steamid_owner ?? "";
    return template
        .replace(/%listingid%/g, listingId)
        .replace(/%assetid%/g, assetId)
        .replace(/%owner_steamid%/g, owner);
};
const fetchListingPage = async (marketHashName, start, count) => {
    const url = buildListingUrl(marketHashName, start, count);
    const response = await (0, repo_1.steamGet)(url, {
        headers: {
            Referer: `https://steamcommunity.com/market/listings/${STEAM_APP_ID}/${encodeURIComponent(marketHashName)}`,
        },
    });
    const payload = response.data ?? {};
    const total = typeof payload.total_count === "number" ? payload.total_count : 0;
    const listings = [];
    const assetsByApp = payload.assets ?? {};
    for (const [listingId, info] of Object.entries(payload.listinginfo ?? {})) {
        if (!info || !listingId)
            continue;
        const appId = String(info.asset?.appid ?? STEAM_APP_ID);
        const contextId = String(info.asset?.contextid ?? "2");
        const assetId = info.asset?.id ?? info.asset?.assetid ?? "";
        const asset = assetsByApp?.[appId]?.[contextId]?.[assetId];
        const inspectLink = resolveInspectLink(listingId, info, asset);
        const priceCents = typeof info.converted_price === "number" && typeof info.converted_fee === "number"
            ? info.converted_price + info.converted_fee
            : null;
        listings.push({
            listingId,
            marketHashName: asset?.market_hash_name ?? marketHashName,
            price: priceCents != null ? priceCents / 100 : null,
            inspectLink,
            sellerId: info.steamid_lister ?? info.steamid_owner ?? null,
            assetId: assetId || null,
        });
    }
    listings.sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
    return { total, listings };
};
const fetchMarketListings = async (marketHashName, limit) => {
    const normalizedName = marketHashName.trim();
    if (!normalizedName)
        return [];
    const effectiveLimit = Math.max(1, Math.min(MAX_LISTINGS_PER_ITEM, limit));
    const result = [];
    const seen = new Set();
    let start = 0;
    let total = Number.POSITIVE_INFINITY;
    while (result.length < effectiveLimit && start < total) {
        const remaining = effectiveLimit - result.length;
        const count = Math.min(STEAM_LISTING_PAGE_SIZE, remaining);
        const { total: pageTotal, listings } = await fetchListingPage(normalizedName, start, count);
        total = Number.isFinite(pageTotal) && pageTotal > 0 ? pageTotal : total;
        if (!listings.length) {
            break;
        }
        for (const listing of listings) {
            if (seen.has(listing.listingId))
                continue;
            seen.add(listing.listingId);
            result.push(listing);
            if (result.length >= effectiveLimit)
                break;
        }
        start += STEAM_LISTING_PAGE_SIZE;
        if (start >= total)
            break;
    }
    result.sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
    return result.slice(0, effectiveLimit);
};
let floatQueue = Promise.resolve();
let lastFloatRequestedAt = 0;
const enqueueFloatRequest = async (task) => {
    const runner = async () => {
        const now = Date.now();
        const waitFor = Math.max(0, FLOAT_REQUEST_INTERVAL_MS - (now - lastFloatRequestedAt));
        if (waitFor > 0) {
            await sleep(waitFor);
        }
        try {
            const result = await task();
            return result;
        }
        finally {
            lastFloatRequestedAt = Date.now();
        }
    };
    const next = floatQueue.then(runner, runner);
    floatQueue = next.then(() => undefined, () => undefined);
    return next;
};
const fetchFloatForListing = async (listing) => {
    if (!listing.inspectLink) {
        return { ...listing, float: null, floatError: "inspect_link_missing" };
    }
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const response = await enqueueFloatRequest(() => axios_1.default.get(FLOAT_API_ENDPOINT, {
                params: { url: listing.inspectLink },
                timeout: 20000,
            }));
            const floatValue = response.data?.iteminfo?.floatvalue;
            if (typeof floatValue === "number" && Number.isFinite(floatValue)) {
                return { ...listing, float: floatValue, floatError: null };
            }
            if (response.data?.error) {
                throw new Error(response.data.error);
            }
            throw new Error("float_missing");
        }
        catch (error) {
            if (attempt === maxAttempts - 1) {
                return { ...listing, float: null, floatError: String(error?.message || error) };
            }
        }
    }
    return { ...listing, float: null, floatError: "unknown" };
};
const fetchListingsWithFloats = async (marketHashName, limit) => {
    const listings = await fetchMarketListings(marketHashName, limit);
    const enriched = [];
    for (const listing of listings) {
        enriched.push(await fetchFloatForListing(listing));
    }
    return enriched;
};
const checkTradeupAvailability = async (payload) => {
    const slots = Array.isArray(payload.slots)
        ? payload.slots.filter((slot) => slot && slot.marketHashName)
        : [];
    if (!slots.length) {
        throw new Error("Не переданы входные слоты");
    }
    const limit = Math.max(1, Math.min(MAX_LISTINGS_PER_ITEM, Number(payload.limit ?? MAX_LISTINGS_PER_ITEM)));
    const outcomeName = String(payload.outcome?.marketHashName ?? "").trim();
    if (!outcomeName) {
        throw new Error("Не указан результат для проверки");
    }
    const uniqueNames = new Map();
    for (const slot of slots) {
        uniqueNames.set(slot.marketHashName, (uniqueNames.get(slot.marketHashName) ?? 0) + 1);
    }
    const listingsByName = new Map();
    for (const name of uniqueNames.keys()) {
        const listings = await fetchListingsWithFloats(name, limit);
        listingsByName.set(name, listings);
    }
    const providedTarget = typeof payload.targetAverageFloat === "number" && Number.isFinite(payload.targetAverageFloat)
        ? clamp(payload.targetAverageFloat, 0, 1)
        : null;
    const minFloat = typeof payload.outcome?.minFloat === "number" && Number.isFinite(payload.outcome.minFloat)
        ? payload.outcome.minFloat
        : null;
    const maxFloat = typeof payload.outcome?.maxFloat === "number" && Number.isFinite(payload.outcome.maxFloat)
        ? payload.outcome.maxFloat
        : null;
    const rollFloat = typeof payload.outcome?.rollFloat === "number" && Number.isFinite(payload.outcome.rollFloat)
        ? payload.outcome.rollFloat
        : null;
    let targetAverageFloat = providedTarget;
    if (targetAverageFloat == null &&
        minFloat != null &&
        maxFloat != null &&
        maxFloat > minFloat &&
        rollFloat != null) {
        targetAverageFloat = clamp((rollFloat - minFloat) / (maxFloat - minFloat), 0, 1);
    }
    const comparator = (a, b) => {
        if (targetAverageFloat != null) {
            const diffA = a.float != null && Number.isFinite(a.float)
                ? Math.abs(a.float - targetAverageFloat)
                : Number.POSITIVE_INFINITY;
            const diffB = b.float != null && Number.isFinite(b.float)
                ? Math.abs(b.float - targetAverageFloat)
                : Number.POSITIVE_INFINITY;
            if (diffA !== diffB) {
                return diffA - diffB;
            }
        }
        const priceA = a.price ?? Number.POSITIVE_INFINITY;
        const priceB = b.price ?? Number.POSITIVE_INFINITY;
        if (priceA !== priceB) {
            return priceA - priceB;
        }
        return a.listingId.localeCompare(b.listingId);
    };
    const pools = new Map();
    for (const [name, listings] of listingsByName.entries()) {
        pools.set(name, listings.slice().sort(comparator));
    }
    const slotResults = [];
    const missingSlots = [];
    for (const slot of slots) {
        const pool = pools.get(slot.marketHashName);
        if (!pool || !pool.length) {
            slotResults.push({ index: slot.index, marketHashName: slot.marketHashName, listing: null });
            missingSlots.push(slot.index);
            continue;
        }
        const listing = pool.shift() ?? null;
        slotResults.push({ index: slot.index, marketHashName: slot.marketHashName, listing });
    }
    slotResults.sort((a, b) => a.index - b.index);
    const floats = slotResults
        .map((slot) => slot.listing?.float)
        .filter((value) => typeof value === "number" && Number.isFinite(value));
    const assignedAverageFloat = floats.length
        ? floats.reduce((sum, value) => sum + value, 0) / floats.length
        : null;
    const groups = {};
    for (const [name, listings] of listingsByName.entries()) {
        groups[name] = listings;
    }
    return {
        outcome: {
            marketHashName: outcomeName,
            minFloat: minFloat ?? null,
            maxFloat: maxFloat ?? null,
            rollFloat: rollFloat ?? null,
        },
        targetAverageFloat,
        assignedAverageFloat,
        slots: slotResults,
        missingSlots,
        groups,
    };
};
exports.checkTradeupAvailability = checkTradeupAvailability;
