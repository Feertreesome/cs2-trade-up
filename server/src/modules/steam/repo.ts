import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { LRUCache } from "lru-cache";
import { RATE_MAX_MS, RATE_MIN_MS, START_RATE_MS } from "../../config";

/** Базовые константы Steam Community Market */
const APP_ID = 730;
const PRICE_URL = "https://steamcommunity.com/market/priceoverview/";
const SEARCH_URL = "https://steamcommunity.com/market/search/render/";
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

/** Формат ответа search/render (урезанный до нужного) */
interface SearchRenderResponse {
  total_count: number;
  results: Array<{
    hash_name: string;
    sell_listings: number;
    sell_price_text?: string;
  }>;
}

/** Формат ответа listings/.../render (для наших целей достаточно total_count) */
interface ListingRenderResponse {
  total_count?: number;
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
  const normalized = String(text)
    .replace(/[^0-9.,]/g, "")
    .replace(",", ".");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
};

/** Читает USD-цену предмета по market_hash_name через priceoverview. */
export const getPriceUSD = async (
  marketHashName: string,
): Promise<number | null> => {
  const cacheKey = `price:${marketHashName}`;
  const cached = memoryCache.get(cacheKey);
  if (cached !== undefined) return cached;

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
    if (!payload?.success) return null;

    const rawPrice = payload.lowest_price ?? payload.median_price;
    if (!rawPrice) return null;

    const parsed = parseSteamPriceText(rawPrice);
    if (parsed == null) return null;

    memoryCache.set(cacheKey, parsed);
    return parsed;
  } catch {
    return null;
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
  sell_price_text?: string;
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
    sell_price_text: result.sell_price_text,
  }));

  const typed = { total, items };
  memoryCache.set(cacheKey, typed);
  return typed;
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

  try {
    // ВАЖНО: типизируем data
    const payload = await steamGetData<ListingRenderResponse>(url);
    const totalCount =
      typeof payload?.total_count === "number" ? payload.total_count : null;
    if (totalCount !== null) memoryCache.set(cacheKey, totalCount);
    return totalCount;
  } catch {
    return null;
  }
};
