import axios, {
  type AxiosRequestConfig,
  type AxiosResponse,
  type AxiosError,
} from "axios";
import { LRUCache } from "lru-cache";
import { RATE_MAX_MS, RATE_MIN_MS, START_RATE_MS } from "../../config";

/** Базовые константы Steam Community Market */
const APP_ID = 730;
const PRICE_URL = "https://steamcommunity.com/market/priceoverview/";
const SEARCH_URL = "https://steamcommunity.com/market/search/render/";
const APP_FILTERS_URL = `https://steamcommunity.com/market/appfilters/${APP_ID}`;
const LISTING_URL = (marketHashName: string) =>
  `https://steamcommunity.com/market/listings/${APP_ID}/${encodeURIComponent(marketHashName)}/render`;

/** Памятующий кеш для снижения нагрузки (разные типы — храним как any) */
const memoryCache = new LRUCache<string, any>({
  max: 5000,
  ttl: 1000 * 60 * 20,
});

/** Формат ответа Steam priceoverview (неофициальный) */
interface PriceOverviewResponse {
  success: boolean;
  lowest_price?: string; // например: "$1.23"
  median_price?: string; // например: "$1.10"
  volume?: string; // строка, бывает "1,234"
}

/** Формат ответа search/render (расширенный до нужного вида) */
interface SearchRenderResponse {
  total_count: number;
  results: Array<{
    name: string;
    hash_name: string;
    sell_listings: number;
    sell_price: number;
    sell_price_text: string;
    app_icon: string;
    app_name: string;
    asset_description: {
      appid: number;
      classid: string;
      instanceid: string;
      background_color: string;
      icon_url: string;
      tradable: number;
      name: string;
      name_color: string;
      type: string;
      market_name: string;
      market_hash_name: string;
      commodity: number;
    };
    sale_price_text: string;
  }>;
}

interface SearchRenderFacetTag {
  tag: string;
  localized_name?: string;
  localized_tag_name?: string;
  localized_count?: string;
}

interface SearchRenderFacet {
  localized_name?: string;
  tags?: Record<string, SearchRenderFacetTag>;
}

interface AppFiltersResponse {
  success?: number | boolean | string;
  message?: string;
  facets?: Record<string, SearchRenderFacet>;
}

/** Формат ответа listings/.../render (для наших целей достаточно total_count) */
interface ListingAssetAction {
  link?: string | null;
}

interface ListingAssetDescriptor {
  id?: string;
  classid?: string;
  instanceid?: string;
  market_actions?: ListingAssetAction[] | null;
  actions?: ListingAssetAction[] | null;
}

interface ListingInfoAsset {
  appid?: number;
  contextid?: string;
  id?: string;
  classid?: string;
  instanceid?: string;
}

interface ListingInfoEntry {
  listingid?: string;
  asset?: ListingInfoAsset | null;
  assetid?: string;
}

interface ListingRenderResponse {
  total_count?: number;
  listinginfo?: Record<string, ListingInfoEntry | null | undefined> | null;
  assets?:
    | Record<string, Record<string, Record<string, Record<string, ListingAssetDescriptor | null>>>>
    | null;
}

export interface ListingInspectLink {
  listingId: string;
  assetId: string;
  inspectLink: string;
}

/** Глобальная очередь с адаптивным троттлингом */
let requestPauseMs = START_RATE_MS;
let cooldownUntilTs = 0;
const queue: Array<{
  run: () => Promise<any>;
  resolve: (v: any) => void;
  reject: (e: unknown) => void;
}> = [];
let queueRunning = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withJitter = (ms: number) => Math.floor(ms * (0.8 + Math.random() * 0.4));
const bumpRate = () => {
  requestPauseMs = Math.min(
    RATE_MAX_MS,
    Math.floor(requestPauseMs * 1.35) + 250,
  );
};
const relaxRate = () => {
  requestPauseMs = Math.max(RATE_MIN_MS, requestPauseMs - 100);
};

/** Максимальное количество одновременных запросов к Steam */
const MAX_PARALLEL_REQUESTS = 5;

/**
 * Кладёт вызов в глобальную очередь, ограничивая параллелизм запросов к Steam.
 */
const enqueue = <T>(runRequest: () => Promise<T>) =>
  new Promise<T>((resolve, reject) => {
    queue.push({ run: runRequest, resolve, reject });
    void runQueue();
  });

/**
 * Внутренний раннер очереди — выполняет пачки запросов с паузами.
 */
const runQueue = async () => {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (queue.length) {
      const batch = queue.splice(0, MAX_PARALLEL_REQUESTS);
      await Promise.all(
        batch.map(async (job) => {
          const now = Date.now();
          if (cooldownUntilTs > now) await sleep(cooldownUntilTs - now);
          try {
            const value = await job.run();
            job.resolve(value);
            relaxRate();
          } catch (error) {
            job.reject(error);
          }
          await sleep(withJitter(requestPauseMs));
        }),
      );
    }
  } finally {
    queueRunning = false;
  }
};

/**
 * Выполняет GET к Steam с ретраями, помещая вызов в очередь.
 * Возвращает ПОЛНЫЙ AxiosResponse<T>.
 */
export const steamGet = async <T = unknown>(
  url: string,
  requestConfig?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> =>
  enqueue<AxiosResponse<T>>(async () => {
    const maxAttempts = 7;
    const baseDelayMs = 900;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await axios.get<T>(url, {
          headers: { "User-Agent": "cs2-tradeup-ev/0.5" },
          timeout: 20_000,
          ...requestConfig,
        });
      } catch (error: any) {
        const status = error?.response?.status as number | undefined;
        const isRetriable =
          status === 429 ||
          (typeof status === "number" && status >= 500 && status < 600) ||
          ["ECONNRESET", "ETIMEDOUT"].includes(error?.code);

        if (!isRetriable || attempt === maxAttempts - 1) throw error;

        if (status === 429) {
          bumpRate();
          cooldownUntilTs = Date.now() + 15_000; // общий «отдых»
        }
        await sleep(withJitter(baseDelayMs * Math.pow(2, attempt)));
      }
    }
    throw new Error("Unreachable");
  });

/**
 * То же, что steamGet, но сразу возвращает типизированный payload (response.data).
 */
const steamGetData = async <T = unknown>(
  url: string,
  requestConfig?: AxiosRequestConfig,
): Promise<T> => {
  const response = await steamGet<T>(url, requestConfig);
  return response.data as T;
};

/**
 * Пытается распарсить цену из текстового поля Steam ("$1.23" / "1,23€" и т.п.).
 * Возвращает число в USD (если currency=1) либо null, если распарсить нельзя.
 */
const parseSteamPriceText = (text: string): number | null => {
  const cleaned = String(text).replace(/[^0-9.,]/g, "");
  if (!cleaned) return null;
  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");
  let decimalSep: "," | "." | null = null;
  if (hasDot && hasComma) {
    decimalSep = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
  } else if (hasComma && !hasDot) {
    const parts = cleaned.split(",");
    decimalSep = parts[parts.length - 1].length <= 2 ? "," : null;
  } else if (hasDot && !hasComma) {
    const parts = cleaned.split(".");
    decimalSep = parts[parts.length - 1].length <= 2 ? "." : null;
  }
  let normalized = cleaned;
  if (decimalSep) {
    const thousand = decimalSep === "," ? /\./g : /,/g;
    normalized = normalized.replace(thousand, "").replace(decimalSep, ".");
  } else {
    normalized = normalized.replace(/[.,]/g, "");
  }
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
};

/** Читает USD-цену предмета по market_hash_name через priceoverview. */
export interface PriceUSDResult {
  price: number | null;
  error?: unknown;
}

export const getPriceUSD = async (
  marketHashName: string,
): Promise<PriceUSDResult> => {
  const cacheKey = `price:${marketHashName}`;
  const cached = memoryCache.get(cacheKey);
  if (cached !== undefined) return { price: cached };

  const params = new URLSearchParams({
    appid: String(APP_ID),
    currency: "1", // USD
    market_hash_name: marketHashName,
  });

  try {
    // ВАЖНО: типизируем data
    const payload = await steamGetData<PriceOverviewResponse>(
      `${PRICE_URL}?${params.toString()}`,
    );

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
    return { price: parsed };
  } catch (error) {
    console.error(`getPriceUSD error for ${marketHashName}`, error);
    return { price: null, error };
  }
};

/** Соответствие «редкость → Steam-тег». */
export const RARITY_TO_TAG: Record<string, string> = {
  "Mil-Spec": "tag_Rarity_Rare_Weapon",
  Restricted: "tag_Rarity_Mythical_Weapon",
  Classified: "tag_Rarity_Legendary_Weapon",
  Covert: "tag_Rarity_Ancient_Weapon",
};

export interface SearchItem {
  market_hash_name: string;
  sell_listings: number;
  price: number | null;
}

export interface SteamCollectionTag {
  tag: string;
  name: string;
  count: number;
}

/**
 * Поиск предметов по редкости через search/render.
 * Используем сортировку по name asc для стабильной пагинации.
 */
export const searchByRarity = async ({
  rarity,
  start = 0,
  count = 30,
  normalOnly = true,
}: {
  rarity: keyof typeof RARITY_TO_TAG;
  start?: number;
  count?: number;
  normalOnly?: boolean;
}): Promise<{ total: number; items: SearchItem[] }> => {
  const params = new URLSearchParams({
    appid: String(APP_ID),
    norender: "1",
    start: String(start),
    count: String(count),
    ...(normalOnly ? { "category_730_Quality[]": "tag_normal" } : {}),
    "category_730_Rarity[]": RARITY_TO_TAG[rarity],
    sort_column: "name",
    sort_dir: "asc",
  });

  const url = `${SEARCH_URL}?${params.toString()}`;
  const cacheKey = `search:${url}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) return cached;

  // ВАЖНО: типизируем data
  const payload = await steamGetData<SearchRenderResponse>(url);

  const total = payload?.total_count ?? 0;
  const items: SearchItem[] = (payload?.results ?? []).map((result) => ({
    market_hash_name: result.hash_name,
    // Steam иногда возвращает sell_listings строкой, нормализуем в число
    sell_listings: Number.parseInt(String(result.sell_listings ?? 0), 10) || 0,
    price: parseSteamPriceText(result.sell_price_text ?? ""),
  }));

  const typed = { total, items };
  memoryCache.set(cacheKey, typed);
  return typed;
};

const parseFacetCount = (value?: string): number => {
  if (!value) return 0;
  const digits = value.replace(/[^0-9]/g, "");
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const fetchAppFilters = async (): Promise<Record<string, SearchRenderFacet>> => {
  const cacheKey = "appfilters";
  const cached = memoryCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ norender: "1" });
  const url = `${APP_FILTERS_URL}?${params.toString()}`;

  const payload = await steamGetData<AppFiltersResponse>(url, {
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

export const fetchCollectionTags = async (): Promise<SteamCollectionTag[]> => {
  const facets = await fetchAppFilters();
  const facet = facets?.["730_ItemSet"] ?? facets?.category_730_ItemSet;
  if (!facet?.tags) return [];

  return Object.entries(facet.tags).map(([tagId, tag]) => {
    const fallbackTag = tagId.startsWith("tag_") ? tagId : `tag_${tagId}`;
    const resolvedTag = tag.tag || fallbackTag;
    return {
      tag: resolvedTag,
      name: tag.localized_name ?? tag.localized_tag_name ?? resolvedTag,
      count: parseFacetCount(tag.localized_count),
    } satisfies SteamCollectionTag;
  });
};

const STEAM_SEARCH_SINGLE_REQUEST_LIMIT = 10;

const buildCollectionSearchParams = ({
  collectionTag,
  rarity,
  start,
  count,
  normalOnly,
}: {
  collectionTag: string;
  rarity?: keyof typeof RARITY_TO_TAG;
  start: number;
  count: number;
  normalOnly: boolean;
}): URLSearchParams => {
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
    params.append("category_730_Rarity[]", RARITY_TO_TAG[rarity]);
  }

  return params;
};

const fetchCollectionPage = async ({
  collectionTag,
  rarity,
  start,
  count,
  normalOnly,
}: {
  collectionTag: string;
  rarity?: keyof typeof RARITY_TO_TAG;
  start: number;
  count: number;
  normalOnly: boolean;
}): Promise<{ total: number; items: SearchItem[] }> => {
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
  if (cached) return cached;

  const payload = await steamGetData<SearchRenderResponse>(url);
  const total = payload?.total_count ?? 0;
  const items: SearchItem[] = (payload?.results ?? []).map((result) => ({
    market_hash_name: result.hash_name,
    sell_listings: Number.parseInt(String(result.sell_listings ?? 0), 10) || 0,
    price: parseSteamPriceText(result.sell_price_text ?? ""),
  }));

  const typed = { total, items };
  memoryCache.set(cacheKey, typed);
  return typed;
};

export const searchByCollection = async ({
  collectionTag,
  rarity,
  start = 0,
  count = 30,
  normalOnly = true,
}: {
  collectionTag: string;
  rarity?: keyof typeof RARITY_TO_TAG;
  start?: number;
  count?: number;
  normalOnly?: boolean;
}): Promise<{ total: number; items: SearchItem[] }> => {
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
  if (aggregateCached) return aggregateCached;

  if (desiredCount === 0) {
    const emptyResult: { total: number; items: SearchItem[] } = { total: 0, items: [] };
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

  const items: SearchItem[] = [];
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

/**
 * Возвращает точное количество листингов для конкретного предмета
 * по странице листингов (render), где есть total_count.
 */
export const fetchListingTotalCount = async (
  marketHashName: string,
): Promise<number | null> => {
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
  if (cached !== undefined) return cached;

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // ВАЖНО: типизируем data
      const payload = await steamGetData<ListingRenderResponse>(url);
      const totalCount =
        typeof payload?.total_count === "number" ? payload.total_count : null;
      if (totalCount !== null) memoryCache.set(cacheKey, totalCount);
      return totalCount;
    } catch (error) {
      const status = (error as AxiosError)?.response?.status;
      if (status === 429 && attempt < maxAttempts - 1) {
        await sleep(16_000);
        continue;
      }
      return null;
    }
  }
  return null;
};

const buildAssetIndex = (payload?: ListingRenderResponse | null) => {
  const index = new Map<string, ListingAssetDescriptor>();
  const appAssets = payload?.assets?.[String(APP_ID)];
  if (!appAssets) return index;

  for (const contextAssets of Object.values(appAssets)) {
    if (!contextAssets) continue;
    for (const classAssets of Object.values(contextAssets)) {
      if (!classAssets) continue;
      for (const asset of Object.values(classAssets)) {
        if (!asset) continue;
        const id = asset.id;
        if (id) {
          index.set(String(id), asset);
        }
      }
    }
  }
  return index;
};

const resolveInspectTemplate = (descriptor?: ListingAssetDescriptor | null) => {
  const actions = descriptor?.market_actions ?? descriptor?.actions ?? [];
  return actions?.find((action) => action?.link?.includes("csgo_econ_action_preview"))?.link ?? null;
};

const applyInspectTemplate = (template: string, listingId: string, assetId: string) =>
  template
    .replace(/%listingid%/gi, listingId)
    .replace(/%assetid%/gi, assetId)
    .replace(/%owner_steamid%/gi, "0")
    .replace(/%purchaser_steamid%/gi, "0")
    .replace(/%steamid%/gi, "0")
    .replace(/%original_amount%/gi, "1")
    .replace(/%amount%/gi, "1");

export const fetchListingInspectLinks = async (
  marketHashName: string,
  options: { start?: number; count?: number } = {},
): Promise<ListingInspectLink[]> => {
  const params = new URLSearchParams({
    start: String(options.start ?? 0),
    count: String(options.count ?? 10),
    currency: "1",
    language: "english",
    format: "json",
  });
  const url = `${LISTING_URL(marketHashName)}?${params.toString()}`;
  const cacheKey = `inspect:${url}`;
  const cached = memoryCache.get(cacheKey) as ListingInspectLink[] | undefined;
  if (cached !== undefined) return cached;

  try {
    const payload = await steamGetData<ListingRenderResponse>(url);
    const assetIndex = buildAssetIndex(payload);
    const inspectLinks: ListingInspectLink[] = [];
    const seen = new Set<string>();
    const entries = payload?.listinginfo ?? {};
    for (const entry of Object.values(entries)) {
      if (!entry) continue;
      const listingId = String(entry.listingid ?? entry.assetid ?? "");
      const assetId = String(entry.asset?.id ?? entry.assetid ?? "");
      if (!listingId || !assetId) continue;
      const descriptor = assetIndex.get(assetId);
      const template = resolveInspectTemplate(descriptor);
      if (!template) continue;
      const inspectLinkKey = `${listingId}:${assetId}`;
      if (seen.has(inspectLinkKey)) continue;
      seen.add(inspectLinkKey);
      const inspectLink = applyInspectTemplate(template, listingId, assetId);
      inspectLinks.push({ listingId, assetId, inspectLink });
    }
    memoryCache.set(cacheKey, inspectLinks);
    return inspectLinks;
  } catch (error) {
    console.warn(`[steam] Failed to fetch listing inspect links for ${marketHashName}: ${String(error)}`);
    return [];
  }
};
