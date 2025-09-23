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
const LISTING_URL = (marketHashName: string) =>
  `https://steamcommunity.com/market/listings/${APP_ID}/${encodeURIComponent(marketHashName)}/render`;

const ensureTagPrefix = (tag: string) =>
  (tag.startsWith("tag_") ? tag : `tag_${tag}`);

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

/** Формат ответа listings/.../render (для наших целей достаточно total_count) */
export interface SteamTag {
  category: string;
  internal_name: string;
  localized_category_name?: string;
  localized_tag_name: string;
}

interface ListingAsset {
  classid?: string;
  instanceid?: string;
  market_hash_name?: string;
  market_name?: string;
  icon_url?: string;
  tags?: SteamTag[];
}

interface ListingRenderResponse {
  total_count?: number;
  assets?: Record<string, Record<string, Record<string, ListingAsset>>>;
}

const extractListingAsset = (
  payload: ListingRenderResponse | null | undefined,
): ListingAsset | null => {
  const appAssets = payload?.assets?.[String(APP_ID)];
  if (!appAssets) return null;
  for (const contextAssets of Object.values(appAssets)) {
    if (!contextAssets) continue;
    for (const asset of Object.values(contextAssets)) {
      if (asset) return asset;
    }
  }
  return null;
};

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

export const searchByCollection = async ({
  collectionTag,
  rarityTag,
  start = 0,
  count = 30,
  normalOnly = true,
}: {
  collectionTag: string;
  rarityTag?: string | null;
  start?: number;
  count?: number;
  normalOnly?: boolean;
}): Promise<{ total: number; items: SearchItem[] }> => {
  const params = new URLSearchParams({
    appid: String(APP_ID),
    norender: "1",
    start: String(start),
    count: String(count),
    sort_column: "name",
    sort_dir: "asc",
    ...(normalOnly ? { "category_730_Quality[]": "tag_normal" } : {}),
  });

  params.append("category_730_ItemSet[]", ensureTagPrefix(collectionTag));
  if (rarityTag) params.append("category_730_Rarity[]", ensureTagPrefix(rarityTag));

  const url = `${SEARCH_URL}?${params.toString()}`;
  const cacheKey = `search:${url}`;
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

type ListingInfo = { totalCount: number | null; asset: ListingAsset | null };

export const fetchListingInfo = async (
  marketHashName: string,
): Promise<ListingInfo> => {
  const params = new URLSearchParams({
    start: "0",
    count: "1",
    currency: "1",
    language: "english",
    format: "json",
  });
  const url = `${LISTING_URL(marketHashName)}?${params.toString()}`;
  const cacheKey = `listing:${url}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) return cached as ListingInfo;

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const payload = await steamGetData<ListingRenderResponse>(url);
      const info: ListingInfo = {
        totalCount:
          typeof payload?.total_count === "number" ? payload.total_count : null,
        asset: extractListingAsset(payload),
      };
      memoryCache.set(cacheKey, info);
      return info;
    } catch (error) {
      const status = (error as AxiosError)?.response?.status;
      if (status === 429 && attempt < maxAttempts - 1) {
        await sleep(16_000);
        continue;
      }
      return { totalCount: null, asset: null };
    }
  }
  return { totalCount: null, asset: null };
};

/**
 * Возвращает точное количество листингов для конкретного предмета
 * по странице листингов (render), где есть total_count.
 */
export const fetchListingTotalCount = async (
  marketHashName: string,
): Promise<number | null> => {
  const { totalCount } = await fetchListingInfo(marketHashName);
  return totalCount;
};

export const fetchListingAsset = async (
  marketHashName: string,
): Promise<ListingAsset | null> => {
  const { asset } = await fetchListingInfo(marketHashName);
  return asset;
};
