"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchListingTotalCount = exports.searchByCollection = exports.fetchCollectionTags = exports.searchByRarity = exports.RARITY_TO_TAG = exports.getPriceUSD = exports.steamGet = exports.RateLimitError = void 0;
const lru_cache_1 = require("lru-cache");
const config_1 = require("../../config");
const prices_1 = require("../../database/prices");
const http_1 = require("../../lib/http");
var http_2 = require("../../lib/http");
Object.defineProperty(exports, "RateLimitError", { enumerable: true, get: function () { return http_2.RateLimitError; } });
/** Базовые константы Steam Community Market */
const APP_ID = 730;
const PRICE_URL = "https://steamcommunity.com/market/priceoverview/";
const SEARCH_URL = "https://steamcommunity.com/market/search/render/";
const APP_FILTERS_URL = `https://steamcommunity.com/market/appfilters/${APP_ID}`;
const LISTING_URL = (marketHashName) => `https://steamcommunity.com/market/listings/${APP_ID}/${encodeURIComponent(marketHashName)}/render`;
/** Памятующий кеш для снижения нагрузки (разные типы — храним как any) */
const memoryCache = new lru_cache_1.LRUCache({
    max: 5000,
    ttl: 1000 * 60 * 20,
});
const parseRetryAfter = (value) => {
    if (value == null)
        return undefined;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber >= 0) {
        // Retry-After может приходить в секундах
        return asNumber * 1000;
    }
    const date = new Date(String(value));
    const diff = date.getTime() - Date.now();
    return Number.isFinite(diff) && diff > 0 ? diff : undefined;
};
/** Глобальная очередь с адаптивным троттлингом */
let requestPauseMs = config_1.START_RATE_MS;
let cooldownUntilTs = 0;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;
const queue = [];
let queueRunning = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withJitter = (ms) => Math.floor(ms * (0.8 + Math.random() * 0.4));
const isNetRetriable = (err) => {
    const status = err?.response?.status;
    return (err?.name === "RateLimitError" ||
        status === 429 ||
        (typeof status === "number" && status >= 500 && status < 600) ||
        ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(err?.code));
};
const computeRetryDelay = (err, attempts) => {
    const retryAfter = err?.retryAfterMs;
    if (typeof retryAfter === "number" && retryAfter >= 0) {
        return Math.min(retryAfter, 5 * 60000);
    }
    const exp = Math.pow(2, Math.max(0, attempts - 1));
    return Math.min(RETRY_BASE_MS * exp, RETRY_MAX_MS);
};
const bumpRate = () => {
    requestPauseMs = Math.min(config_1.RATE_MAX_MS, Math.floor(requestPauseMs * 1.35) + 250);
};
const relaxRate = () => {
    requestPauseMs = Math.max(config_1.RATE_MIN_MS, requestPauseMs - 100);
};
/** Максимальное количество одновременных запросов к Steam */
const MAX_PARALLEL_REQUESTS = 5;
/**
 * Кладёт вызов в глобальную очередь, ограничивая параллелизм запросов к Steam.
 */
const enqueue = (runRequest) => new Promise((resolve, reject) => {
    const job = { run: runRequest, resolve, reject, attempts: 0 };
    queue.push(job);
    void runQueue();
});
/**
 * Внутренний раннер очереди — выполняет пачки запросов с паузами.
 */
const runQueue = async () => {
    if (queueRunning)
        return;
    queueRunning = true;
    try {
        while (queue.length) {
            const batch = queue.splice(0, MAX_PARALLEL_REQUESTS);
            await Promise.all(batch.map(async (job) => {
                const now = Date.now();
                if (cooldownUntilTs > now)
                    await sleep(cooldownUntilTs - now);
                try {
                    const value = await job.run();
                    job.resolve(value);
                    relaxRate();
                }
                catch (error) {
                    if (isNetRetriable(error)) {
                        job.attempts += 1;
                        const delay = withJitter(computeRetryDelay(error, job.attempts));
                        const next = Date.now() + delay;
                        cooldownUntilTs = Math.max(cooldownUntilTs, next);
                        queue.push(job);
                    }
                    else {
                        job.reject(error);
                    }
                }
                await sleep(withJitter(requestPauseMs));
            }));
        }
    }
    finally {
        queueRunning = false;
    }
};
/**
 * Выполняет GET к Steam с ретраями, помещая вызов в очередь.
 * Возвращает ПОЛНЫЙ AxiosResponse<T>.
 */
const steamGet = async (url, requestConfig) => enqueue(async () => {
    const maxAttempts = 7;
    const baseDelayMs = 900;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await http_1.http.get(url, {
                ...requestConfig,
            });
        }
        catch (error) {
            const retryAfterMs = error instanceof http_1.RateLimitError
                ? error.retryAfterMs
                : parseRetryAfter(error?.response?.headers?.["retry-after"]);
            const status = error instanceof http_1.RateLimitError
                ? 429
                : error?.response?.status;
            const code = error?.code;
            const isRetriable = status === 429 ||
                (typeof status === "number" && status >= 500 && status < 600) ||
                (code ? ["ECONNRESET", "ETIMEDOUT"].includes(code) : false);
            if (!isRetriable || attempt === maxAttempts - 1)
                throw error;
            if (status === 429) {
                bumpRate();
                const cooldownMs = typeof retryAfterMs === "number" ? Math.min(retryAfterMs, 60000) : 15000;
                cooldownUntilTs = Date.now() + cooldownMs;
            }
            const backoffMs = typeof retryAfterMs === "number"
                ? retryAfterMs
                : withJitter(baseDelayMs * Math.pow(2, attempt));
            await sleep(backoffMs);
        }
    }
    throw new Error("Unreachable");
});
exports.steamGet = steamGet;
/**
 * Пытается распарсить цену из текстового поля Steam ("$1.23" / "1,23€" и т.п.).
 * Возвращает число в USD (если currency=1) либо null, если распарсить нельзя.
 */
const parseSteamPriceText = (text) => {
    const cleaned = String(text).replace(/[^0-9.,]/g, "");
    if (!cleaned)
        return null;
    const hasDot = cleaned.includes(".");
    const hasComma = cleaned.includes(",");
    let decimalSep = null;
    if (hasDot && hasComma) {
        decimalSep = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
    }
    else if (hasComma && !hasDot) {
        const parts = cleaned.split(",");
        decimalSep = parts[parts.length - 1].length <= 2 ? "," : null;
    }
    else if (hasDot && !hasComma) {
        const parts = cleaned.split(".");
        decimalSep = parts[parts.length - 1].length <= 2 ? "." : null;
    }
    let normalized = cleaned;
    if (decimalSep) {
        const thousand = decimalSep === "," ? /\./g : /,/g;
        normalized = normalized.replace(thousand, "").replace(decimalSep, ".");
    }
    else {
        normalized = normalized.replace(/[.,]/g, "");
    }
    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : null;
};
const getPriceUSD = async (marketHashName) => {
    const cacheKey = `price:${marketHashName}`;
    const cached = memoryCache.get(cacheKey);
    if (cached !== undefined)
        return { price: cached };
    const params = new URLSearchParams({
        appid: String(APP_ID),
        currency: "1", // USD
        market_hash_name: marketHashName,
    });
    try {
        // ВАЖНО: типизируем data
        const { data: payload } = await (0, exports.steamGet)(`${PRICE_URL}?${params.toString()}`);
        if (!payload?.success) {
            console.warn("getPriceUSD: payload.success is false", {
                marketHashName,
                payload,
            });
            return { price: null, error: "payload_not_success" };
        }
        const rawPrice = payload.lowest_price ?? payload.median_price;
        if (!rawPrice) {
            console.warn("getPriceUSD: price fields missing", {
                marketHashName,
                payload,
            });
            return { price: null, error: "price_missing" };
        }
        const parsed = parseSteamPriceText(rawPrice);
        if (parsed == null) {
            console.warn("getPriceUSD: failed to parse price", {
                marketHashName,
                rawPrice,
            });
            return { price: null, error: "parse_failed" };
        }
        memoryCache.set(cacheKey, parsed);
        void (0, prices_1.recordPriceSnapshot)(marketHashName, parsed);
        return { price: parsed };
    }
    catch (error) {
        console.error(`getPriceUSD error for ${marketHashName}`, error);
        return { price: null, error };
    }
};
exports.getPriceUSD = getPriceUSD;
/** Соответствие «редкость → Steam-тег». */
exports.RARITY_TO_TAG = {
    "Mil-Spec": "tag_Rarity_Rare_Weapon",
    Restricted: "tag_Rarity_Mythical_Weapon",
    Classified: "tag_Rarity_Legendary_Weapon",
    Covert: "tag_Rarity_Ancient_Weapon",
};
/**
 * Поиск предметов по редкости через search/render.
 * Используем сортировку по name asc для стабильной пагинации.
 */
const searchByRarity = async ({ rarity, start = 0, count = 30, normalOnly = true, }) => {
    const params = new URLSearchParams({
        appid: String(APP_ID),
        norender: "1",
        start: String(start),
        count: String(count),
        ...(normalOnly ? { "category_730_Quality[]": "tag_normal" } : {}),
        "category_730_Rarity[]": exports.RARITY_TO_TAG[rarity],
        sort_column: "name",
        sort_dir: "asc",
    });
    const url = `${SEARCH_URL}?${params.toString()}`;
    const cacheKey = `search:${url}`;
    const cached = memoryCache.get(cacheKey);
    if (cached)
        return cached;
    // ВАЖНО: типизируем data
    const { data: payload } = await (0, exports.steamGet)(url);
    const total = payload?.total_count ?? 0;
    const items = (payload?.results ?? []).map((result) => {
        const description = result.asset_description ?? {};
        const rawTradable = description?.tradable;
        const tradable = typeof rawTradable === "number"
            ? rawTradable === 1
            : typeof rawTradable === "boolean"
                ? rawTradable
                : undefined;
        return {
            market_hash_name: result.hash_name,
            // Steam иногда возвращает sell_listings строкой, нормализуем в число
            sell_listings: Number.parseInt(String(result.sell_listings ?? 0), 10) || 0,
            price: parseSteamPriceText(result.sell_price_text ?? ""),
            market_name: description?.market_name ?? description?.name ?? result.name,
            name: result.name,
            app_icon: result.app_icon,
            app_name: result.app_name,
            icon_url: description?.icon_url,
            type: description?.type,
            classid: description?.classid,
            instanceid: description?.instanceid,
            tradable,
        };
    });
    const typed = { total, items };
    memoryCache.set(cacheKey, typed);
    return typed;
};
exports.searchByRarity = searchByRarity;
const parseFacetCount = (value) => {
    if (!value)
        return 0;
    const digits = value.replace(/[^0-9]/g, "");
    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};
const fetchAppFilters = async () => {
    const cacheKey = "appfilters";
    const cached = memoryCache.get(cacheKey);
    if (cached)
        return cached;
    const params = new URLSearchParams({ norender: "1" });
    const url = `${APP_FILTERS_URL}?${params.toString()}`;
    const { data: payload } = await (0, exports.steamGet)(url, {
        headers: { Referer: "https://steamcommunity.com/market/" },
    });
    const isSuccess = payload?.success === true || payload?.success === 1 || payload?.success === "1";
    if (!isSuccess) {
        const errorMessage = payload?.message ?? "Failed to fetch market app filters";
        throw new Error(errorMessage);
    }
    const facets = payload?.facets ?? {};
    memoryCache.set(cacheKey, facets);
    return facets;
};
const fetchCollectionTags = async () => {
    const facets = await fetchAppFilters();
    const facet = facets?.["730_ItemSet"] ?? facets?.category_730_ItemSet;
    if (!facet?.tags)
        return [];
    return Object.entries(facet.tags).map(([tagId, tag]) => {
        const fallbackTag = tagId.startsWith("tag_") ? tagId : `tag_${tagId}`;
        const resolvedTag = tag.tag || fallbackTag;
        return {
            tag: resolvedTag,
            name: tag.localized_name ?? tag.localized_tag_name ?? resolvedTag,
            count: parseFacetCount(tag.localized_count),
        };
    });
};
exports.fetchCollectionTags = fetchCollectionTags;
const STEAM_SEARCH_SINGLE_REQUEST_LIMIT = 10;
const buildCollectionSearchParams = ({ collectionTag, rarity, start, count, normalOnly, }) => {
    const params = new URLSearchParams({
        appid: String(APP_ID),
        norender: "1",
        start: String(start),
        count: String(count),
        sort_column: "name",
        sort_dir: "asc",
    });
    if (normalOnly) {
        params.append("category_730_Quality[]", "tag_normal");
    }
    params.append("category_730_ItemSet[]", collectionTag);
    if (rarity) {
        params.append("category_730_Rarity[]", exports.RARITY_TO_TAG[rarity]);
    }
    return params;
};
const fetchCollectionPage = async ({ collectionTag, rarity, start, count, normalOnly, }) => {
    const params = buildCollectionSearchParams({
        collectionTag,
        rarity,
        start,
        count: Math.min(count, STEAM_SEARCH_SINGLE_REQUEST_LIMIT),
        normalOnly,
    });
    const url = `${SEARCH_URL}?${params.toString()}`;
    const cacheKey = `collection:${url}`;
    const cached = memoryCache.get(cacheKey);
    if (cached)
        return cached;
    const { data: payload } = await (0, exports.steamGet)(url);
    const total = payload?.total_count ?? 0;
    const items = (payload?.results ?? []).map((result) => {
        const description = result.asset_description ?? {};
        const rawTradable = description?.tradable;
        const tradable = typeof rawTradable === "number"
            ? rawTradable === 1
            : typeof rawTradable === "boolean"
                ? rawTradable
                : undefined;
        return {
            market_hash_name: result.hash_name,
            sell_listings: Number.parseInt(String(result.sell_listings ?? 0), 10) || 0,
            price: parseSteamPriceText(result.sell_price_text ?? ""),
            market_name: description?.market_name ?? description?.name ?? result.name,
            name: result.name,
            app_icon: result.app_icon,
            app_name: result.app_name,
            icon_url: description?.icon_url,
            type: description?.type,
            classid: description?.classid,
            instanceid: description?.instanceid,
            tradable,
        };
    });
    const typed = { total, items };
    memoryCache.set(cacheKey, typed);
    return typed;
};
const searchByCollection = async ({ collectionTag, rarity, start = 0, count = 30, normalOnly = true, }) => {
    const desiredCount = Math.max(0, count);
    const baseParams = buildCollectionSearchParams({
        collectionTag,
        rarity,
        start,
        count: desiredCount,
        normalOnly,
    });
    const aggregateUrl = `${SEARCH_URL}?${baseParams.toString()}`;
    const aggregateCacheKey = `collection:${aggregateUrl}`;
    const aggregateCached = memoryCache.get(aggregateCacheKey);
    if (aggregateCached)
        return aggregateCached;
    if (desiredCount === 0) {
        const emptyResult = { total: 0, items: [] };
        memoryCache.set(aggregateCacheKey, emptyResult);
        return emptyResult;
    }
    if (desiredCount <= STEAM_SEARCH_SINGLE_REQUEST_LIMIT) {
        const singlePage = await fetchCollectionPage({
            collectionTag,
            rarity,
            start,
            count: desiredCount,
            normalOnly,
        });
        memoryCache.set(aggregateCacheKey, singlePage);
        return singlePage;
    }
    const items = [];
    let total = 0;
    let currentStart = start;
    while (items.length < desiredCount) {
        const remaining = desiredCount - items.length;
        const requestCount = Math.min(remaining, STEAM_SEARCH_SINGLE_REQUEST_LIMIT);
        const { total: pageTotal, items: pageItems } = await fetchCollectionPage({
            collectionTag,
            rarity,
            start: currentStart,
            count: requestCount,
            normalOnly,
        });
        if (!items.length) {
            total = pageTotal;
        }
        if (!pageItems.length) {
            break;
        }
        items.push(...pageItems);
        currentStart += pageItems.length;
        if (currentStart >= pageTotal) {
            break;
        }
        if (pageItems.length < requestCount) {
            break;
        }
    }
    const result = { total, items };
    memoryCache.set(aggregateCacheKey, result);
    return result;
};
exports.searchByCollection = searchByCollection;
/**
 * Возвращает точное количество листингов для конкретного предмета
 * по странице листингов (render), где есть total_count.
 */
const fetchListingTotalCount = async (marketHashName) => {
    const params = new URLSearchParams({
        start: "0",
        count: "1",
        currency: "1",
        language: "english",
        format: "json",
    });
    const url = `${LISTING_URL(marketHashName)}?${params.toString()}`;
    const cacheKey = `listingTotal:${url}`;
    const cached = memoryCache.get(cacheKey);
    if (cached !== undefined)
        return cached;
    try {
        const { data: payload } = await (0, exports.steamGet)(url);
        const totalCount = typeof payload?.total_count === "number" ? payload.total_count : null;
        if (totalCount !== null)
            memoryCache.set(cacheKey, totalCount);
        return totalCount;
    }
    catch (error) {
        if (error instanceof http_1.RateLimitError)
            throw error;
        return null;
    }
};
exports.fetchListingTotalCount = fetchListingTotalCount;
