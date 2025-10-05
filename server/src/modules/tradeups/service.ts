/**
 * Модуль бизнес-логики trade-up калькулятора. Содержит функции, которые
 * переиспользуются в HTTP-роутере и в клиентском приложении через API.
 * Здесь же реализованы вспомогательные структуры и кеши для сопоставления
 * коллекций Steam с нашим справочником float-диапазонов.
 */
import axios, { isAxiosError } from "axios";
import {
  COLLECTIONS_WITH_FLOAT,
  COLLECTIONS_WITH_FLOAT_MAP,
  COLLECTIONS_WITH_FLOAT_BY_NAME,
  COVERT_FLOAT_BY_BASENAME,
  CLASSIFIED_FLOAT_BY_BASENAME,
  rebuildCollectionFloatCaches,
  type CollectionFloatCatalogEntry,
  type CollectionFloatRange,
} from "../../../../data/CollectionsWithFloat";
import { STEAM_MAX_AUTO_LIMIT, STEAM_PAGE_SIZE } from "../../config";
import {
  fetchCollectionTags,
  getPriceUSD,
  searchByCollection,
  steamGet,
  RARITY_TO_TAG,
  type SearchItem,
  type SteamCollectionTag,
} from "../steam/repo";
import {
  baseFromMarketHash,
  parseMarketHashExterior,
  type Exterior,
} from "../skins/service";
import { getSkinFloatRange, type SkinFloatRange } from "./floatRanges";

const DEFAULT_BUYER_TO_NET = 1.15;

const WEAR_BUCKETS: Array<{ exterior: Exterior; min: number; max: number }> = [
  { exterior: "Factory New", min: 0, max: 0.06999999999999999 },
  { exterior: "Minimal Wear", min: 0.07, max: 0.14999999999999999 },
  { exterior: "Field-Tested", min: 0.15, max: 0.37999999999999999 },
  { exterior: "Well-Worn", min: 0.38, max: 0.44999999999999999 },
  { exterior: "Battle-Scarred", min: 0.45, max: 1 },
];

/** Ограничивает значение указанным диапазоном. */
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const isWithinBucket = (
  value: number,
  bucket: { min: number; max: number },
  inclusiveMax: boolean,
  tolerance = Number.EPSILON,
) => {
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
const getExteriorByFloat = (float: number): Exterior => {
  const bucket = WEAR_BUCKETS.find((entry, index) =>
    isWithinBucket(float, entry, index === WEAR_BUCKETS.length - 1),
  );
  return bucket?.exterior ?? WEAR_BUCKETS[WEAR_BUCKETS.length - 1].exterior;
};

/** Находит числовой диапазон wear-ступени. */
const getWearRange = (exterior: Exterior) =>
  WEAR_BUCKETS.find((entry) => entry.exterior === exterior) ?? WEAR_BUCKETS[WEAR_BUCKETS.length - 1];

export interface TradeupInputSlot {
  marketHashName: string;
  float: number;
  /** Идентификатор коллекции, к которой относится входной предмет. */
  collectionId: string;
  /** Минимальный float входного предмета (если известен). */
  minFloat?: number | null;
  /** Максимальный float входного предмета (если известен). */
  maxFloat?: number | null;
  /**
   * Нетто-стоимость предмета (после вычета комиссий).
   * Если не передана, сервер попытается получить цену самостоятельно.
   */
  priceOverrideNet?: number | null;
}

export interface TradeupOptions {
  /** Коэффициент buyer -> net. По умолчанию 1.15 (15% комиссии Steam). */
  buyerToNetRate?: number;
}

export interface TargetOverrideRequest {
  collectionId?: string | null;
  collectionTag?: string | null;
  baseName: string;
  exterior?: Exterior | null;
  marketHashName?: string | null;
  minFloat?: number | null;
  maxFloat?: number | null;
  price?: number | null;
}

export interface TradeupRequestPayload {
  inputs: TradeupInputSlot[];
  targetCollectionIds: string[];
  targetRarity?: "Covert" | "Classified";
  options?: TradeupOptions;
  targetOverrides?: TargetOverrideRequest[];
}

export interface TradeupInputSummary extends TradeupInputSlot {
  priceMarket?: number | null;
  netPrice?: number | null;
  priceError?: unknown;
}

export interface TradeupOutcome {
  collectionId: string;
  collectionName: string;
  baseName: string;
  minFloat: number;
  maxFloat: number;
  rollFloat: number;
  exterior: Exterior;
  wearRange: { min: number; max: number };
  probability: number;
  buyerPrice?: number | null;
  netPrice?: number | null;
  priceError?: unknown;
  marketHashName: string;
  withinRange: boolean;
}

export interface TradeupCalculationResult {
  averageFloat: number;
  normalizedAverageFloat: number;
  normalizationMode: "normalized" | "simple";
  inputs: TradeupInputSummary[];
  outcomes: TradeupOutcome[];
  totalInputNet: number;
  totalOutcomeNet: number;
  expectedValue: number;
  maxBudgetPerSlot: number;
  positiveOutcomeProbability: number;
  warnings: string[];
}

/** Собирает market_hash_name из базового названия и износа. */
const toMarketHashName = (baseName: string, exterior: Exterior) =>
  `${baseName} (${exterior})`;

/**
 * Собирает подробности по одному потенциальному исходу trade-up'а и подтягивает цену из Steam.
 */
const buildOutcome = async (
  options: {
    inputAverageFloat: number;
    collection: CollectionFloatCatalogEntry;
    entry: CollectionFloatRange;
    collectionProbability: number;
    rangeCount: number;
    buyerToNetRate: number;
    override?: TargetOverrideRequest;
  },
): Promise<TradeupOutcome> => {
  const {
    inputAverageFloat,
    collection,
    entry,
    collectionProbability,
    rangeCount,
    buyerToNetRate,
    override,
  } = options;

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
  let priceError: unknown = undefined;
  if (buyerPrice == null) {
    const { price, error } = await getPriceUSD(marketHashName);
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
const enrichInput = async (
  input: TradeupInputSlot,
  buyerToNetRate: number,
): Promise<TradeupInputSummary> => {
  if (input.priceOverrideNet != null) {
    return {
      ...input,
      priceMarket: input.priceOverrideNet * buyerToNetRate,
      netPrice: input.priceOverrideNet,
    };
  }

  const { price, error } = await getPriceUSD(input.marketHashName);
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
export const getCollectionsCatalog = (): CollectionFloatCatalogEntry[] => {
  ensureCollectionCaches();
  return COLLECTIONS_WITH_FLOAT.slice();
};

const STEAM_TAG_TO_COLLECTION_ID = new Map<string, string | null>();

export const resetTradeupCaches = () => {
  collectionCachesReady = false;
  STEAM_TAG_TO_COLLECTION_ID.clear();
};

export const warmTradeupCatalog = () => {
  resetTradeupCaches();
  ensureCollectionCaches();
};

export interface SteamCollectionSummary extends SteamCollectionTag {
  collectionId: string | null;
}

const rememberCollectionId = (tag: string, collectionId: string | null) => {
  STEAM_TAG_TO_COLLECTION_ID.set(tag, collectionId);
  return collectionId;
};

const findCollectionIdByTag = (tag: string): string | null => {
  if (STEAM_TAG_TO_COLLECTION_ID.has(tag)) {
    return STEAM_TAG_TO_COLLECTION_ID.get(tag) ?? null;
  }
  return null;
};

const guessCollectionIdByBaseNames = (baseNames: string[]): string | null => {
  ensureCollectionCaches();
  for (const entry of COLLECTIONS_WITH_FLOAT) {
    const hasMatch =
      entry.covert.some((covert) => baseNames.includes(covert.baseName)) ||
      entry.classified.some((classified) => baseNames.includes(classified.baseName));
    if (hasMatch) {
      return entry.id;
    }
  }
  return null;
};

export const fetchSteamCollections = async (): Promise<SteamCollectionSummary[]> => {
  ensureCollectionCaches();
  const tags = await fetchCollectionTags();
  return tags.map((tag) => {
    const collection = COLLECTIONS_WITH_FLOAT_BY_NAME.get(tag.name.toLowerCase());
    const collectionId = rememberCollectionId(tag.tag, collection?.id ?? null);
    return { ...tag, collectionId };
  });
};

/**
 * Выгружает страницу за страницей весь список предметов конкретной коллекции.
 */
const fetchEntireCollection = async (options: {
  collectionTag: string;
  rarity?: keyof typeof RARITY_TO_TAG;
}): Promise<SearchItem[]> => {
  const pageSize = STEAM_PAGE_SIZE;
  const hardLimit = STEAM_MAX_AUTO_LIMIT;
  const items: SearchItem[] = [];
  let start = 0;
  let total = 0;

  while (true) {
    const remaining = hardLimit - start;
    if (remaining <= 0) break;
    const requestCount = Math.min(pageSize, remaining);

    const { items: pageItems, total: totalCount } = await searchByCollection({
      collectionTag: options.collectionTag,
      rarity: options.rarity,
      start,
      count: requestCount,
      normalOnly: true,
    });

    if (!items.length) total = totalCount;
    if (!pageItems.length) break;

    items.push(...pageItems);
    start += pageItems.length;

    if (start >= totalCount || start >= hardLimit || pageItems.length < requestCount) break;
    if (start >= Math.min(hardLimit, 600)) break; // safety guard against runaway pagination
  }

  return items;
};

export interface CollectionTargetExterior {
  exterior: Exterior;
  marketHashName: string;
  price?: number | null;
  minFloat?: number;
  maxFloat?: number;
}

export interface CollectionTargetSummary {
  baseName: string;
  exteriors: CollectionTargetExterior[];
}

export interface CollectionTargetsResult {
  collectionTag: string;
  collectionId: string | null;
  rarity: "Covert" | "Classified";
  targets: CollectionTargetSummary[];
}

/**
 * Загружает Covert-предметы коллекции, группирует их по базовому названию и дополняет float-диапазоном.
 */
export const fetchCollectionTargets = async (
  collectionTag: string,
  rarity: "Covert" | "Classified" = "Covert",
): Promise<CollectionTargetsResult> => {
  ensureCollectionCaches();
  const items = await fetchEntireCollection({ collectionTag, rarity });
  const grouped = new Map<string, CollectionTargetSummary>();
  const baseNames: string[] = [];
  const floatCache = new Map<string, SkinFloatRange | undefined>();
  const predefinedFloats =
    rarity === "Classified" ? CLASSIFIED_FLOAT_BY_BASENAME : COVERT_FLOAT_BY_BASENAME;

  for (const item of items) {
    const exterior = parseMarketHashExterior(item.market_hash_name);
    const baseName = baseFromMarketHash(item.market_hash_name);
    let floats = predefinedFloats.get(baseName);
    if (!floats) {
      if (!floatCache.has(baseName)) {
        const range = await getSkinFloatRange(item.market_hash_name);
        floatCache.set(baseName, range ?? undefined);
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

  let collectionId = findCollectionIdByTag(collectionTag);
  if (collectionId == null) {
    collectionId = rememberCollectionId(
      collectionTag,
      guessCollectionIdByBaseNames(baseNames),
    );
  }

  return {
    collectionTag,
    collectionId,
    rarity,
    targets: Array.from(grouped.values()),
  };
};

export interface CollectionInputSummary {
  baseName: string;
  marketHashName: string;
  exterior: Exterior;
  price?: number | null;
}

export interface CollectionInputsResult {
  collectionTag: string;
  collectionId: string | null;
  rarity: "Classified" | "Restricted";
  inputs: CollectionInputSummary[];
}

/**
 * Получает список предметов коллекции, которые могут служить входами для trade-up'а.
 */
export const fetchCollectionInputs = async (
  collectionTag: string,
  targetRarity: "Covert" | "Classified" = "Covert",
): Promise<CollectionInputsResult> => {
  ensureCollectionCaches();
  const inputRarity: "Classified" | "Restricted" =
    targetRarity === "Classified" ? "Restricted" : "Classified";
  const items = await fetchEntireCollection({
    collectionTag,
    rarity: inputRarity,
  });

  const inputs: CollectionInputSummary[] = items.map((item) => ({
    baseName: baseFromMarketHash(item.market_hash_name),
    marketHashName: item.market_hash_name,
    exterior: parseMarketHashExterior(item.market_hash_name),
    price: item.price,
  }));

  let collectionId = findCollectionIdByTag(collectionTag);
  if (collectionId == null && inputs.length) {
    collectionId = rememberCollectionId(
      collectionTag,
      guessCollectionIdByBaseNames(inputs.map((input) => input.baseName)),
    );
  }

  return { collectionTag, collectionId, rarity: inputRarity, inputs };
};

/**
 * Основной расчёт: принимает 10 входов, список целевых коллекций и возвращает распределение исходов.
 */
export const calculateTradeup = async (
  payload: TradeupRequestPayload,
): Promise<TradeupCalculationResult> => {
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

  const normalizedValues = await Promise.all(
    inputs.map(async (slot) => {
      const min = typeof slot.minFloat === "number" ? slot.minFloat : null;
      const max = typeof slot.maxFloat === "number" ? slot.maxFloat : null;
      let rangeMin = min;
      let rangeMax = max;
      if (rangeMin == null || rangeMax == null || rangeMax <= rangeMin) {
        const range = await getSkinFloatRange(slot.marketHashName);
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
    }),
  );

  const canUseNormalized = normalizedValues.every((value) => value != null);
  const normalizedAverageFloat = canUseNormalized
    ? normalizedValues.reduce((sum, value) => sum + (value ?? 0), 0) / Math.max(totalInputs, 1)
    : averageFloat;

  const collectionCounts = new Map<string, number>();
  for (const slot of inputs) {
    collectionCounts.set(slot.collectionId, (collectionCounts.get(slot.collectionId) ?? 0) + 1);
  }

  const overridesByCollection = new Map<string, TargetOverrideRequest>();
  for (const override of payload.targetOverrides ?? []) {
    if (!override?.baseName) continue;
    let collectionId = override.collectionId ?? null;
    if (!collectionId && override.collectionTag) {
      collectionId = findCollectionIdByTag(override.collectionTag);
    }
    if (!collectionId) continue;
    const key = `${collectionId}:${override.baseName.toLowerCase()}`;
    if (!overridesByCollection.has(key)) {
      overridesByCollection.set(key, { ...override, collectionId });
    }
  }

  const targetRarity: "Covert" | "Classified" =
    payload.targetRarity === "Classified" ? "Classified" : "Covert";

  const targetCollections = payload.targetCollectionIds
    .map((id) => COLLECTIONS_WITH_FLOAT_MAP.get(id))
    .filter((collection): collection is CollectionFloatCatalogEntry => Boolean(collection));

  if (!targetCollections.length) {
    throw new Error("No valid target collections specified");
  }

  const outcomes = await Promise.all(
    targetCollections.flatMap((collection) => {
      const collectionProbability = (collectionCounts.get(collection.id) ?? 0) / totalInputs;
      const candidates =
        targetRarity === "Classified" ? collection.classified : collection.covert;
      const rangeCount = candidates.length;
      if (!rangeCount) {
        return [];
      }
      return candidates.map((entry) =>
        buildOutcome({
          inputAverageFloat: averageFloat,
          collection,
          entry,
          collectionProbability,
          rangeCount,
          buyerToNetRate,
          override: overridesByCollection.get(`${collection.id}:${entry.baseName.toLowerCase()}`),
        }),
      );
    }),
  );

  const inputSummaries = await Promise.all(
    inputs.map((slot) => enrichInput(slot, buyerToNetRate)),
  );

  const totalInputNet = inputSummaries.reduce(
    (sum, slot) => sum + (slot.netPrice ?? 0),
    0,
  );
  const totalOutcomeNet = outcomes.reduce(
    (sum, outcome) => sum + outcome.probability * (outcome.netPrice ?? 0),
    0,
  );
  const expectedValue = totalOutcomeNet - totalInputNet;
  const maxBudgetPerSlot = totalInputs ? totalOutcomeNet / totalInputs : 0;

  const positiveOutcomeProbability = outcomes.reduce((sum, outcome) => {
    if (outcome.netPrice != null && outcome.netPrice > totalInputNet) {
      return sum + outcome.probability;
    }
    return sum;
  }, 0);

  const warnings: string[] = [];
  if (!canUseNormalized) {
    warnings.push("Не удалось получить точные диапазоны float для всех входов — используется упрощённое среднее.");
  }
  for (const outcome of outcomes) {
    if (!outcome.withinRange) {
      warnings.push(
        `${outcome.baseName} roll float ${outcome.rollFloat.toFixed(4)} is outside declared range`,
      );
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

const STEAM_APP_ID = 730;
const STEAM_LISTING_PAGE_SIZE = 10;
const MAX_LISTINGS_PER_ITEM = 50;
const FLOAT_REQUEST_INTERVAL_MS = 1500;
const FLOAT_API_ENDPOINT = "https://api.csgofloat.com/";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ListingRenderAction {
  link?: string;
}

interface ListingRenderAsset {
  id?: string;
  classid?: string;
  instanceid?: string;
  market_hash_name?: string;
  market_actions?: ListingRenderAction[];
  actions?: ListingRenderAction[];
}

interface ListingRenderListingInfo {
  listingid?: string;
  converted_price?: number;
  converted_fee?: number;
  steamid_lister?: string;
  steamid_owner?: string;
  asset?: {
    currency?: number;
    appid?: number;
    contextid?: string;
    id?: string;
    assetid?: string;
    market_actions?: ListingRenderAction[];
    actions?: ListingRenderAction[];
  };
}

interface ListingRenderResponse {
  total_count?: number;
  listinginfo?: Record<string, ListingRenderListingInfo | undefined>;
  assets?: Record<string, Record<string, Record<string, ListingRenderAsset>>>;
}

interface MarketListingItem {
  listingId: string;
  marketHashName: string;
  price: number | null;
  inspectLink: string | null;
  sellerId: string | null;
  assetId: string | null;
}

interface MarketListingWithFloat extends MarketListingItem {
  float: number | null;
  floatError: string | null;
}

const buildListingUrl = (marketHashName: string, start: number, count: number) => {
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

const resolveInspectLink = (
  listingId: string,
  info: ListingRenderListingInfo,
  asset: ListingRenderAsset | undefined,
): string | null => {
  const actions =
    asset?.market_actions ??
    asset?.actions ??
    info.asset?.market_actions ??
    info.asset?.actions ??
    [];
  const template = actions[0]?.link;
  if (!template) return null;
  const assetId = asset?.id ?? info.asset?.id ?? info.asset?.assetid ?? "";
  const owner = info.steamid_lister ?? info.steamid_owner ?? "";
  return template
    .replace(/%listingid%/g, listingId)
    .replace(/%assetid%/g, assetId)
    .replace(/%owner_steamid%/g, owner);
};

const fetchListingPage = async (
  marketHashName: string,
  start: number,
  count: number,
): Promise<{ total: number; listings: MarketListingItem[] }> => {
  const url = buildListingUrl(marketHashName, start, count);
  const response = await steamGet<ListingRenderResponse>(url, {
    headers: {
      Referer: `https://steamcommunity.com/market/listings/${STEAM_APP_ID}/${encodeURIComponent(marketHashName)}`,
    },
  });
  const payload = response.data ?? {};
  const total = typeof payload.total_count === "number" ? payload.total_count : 0;
  const listings: MarketListingItem[] = [];
  const assetsByApp = payload.assets ?? {};

  for (const [listingId, info] of Object.entries(payload.listinginfo ?? {})) {
    if (!info || !listingId) continue;
    const appId = String(info.asset?.appid ?? STEAM_APP_ID);
    const contextId = String(info.asset?.contextid ?? "2");
    const assetId = info.asset?.id ?? info.asset?.assetid ?? "";
    const asset = assetsByApp?.[appId]?.[contextId]?.[assetId];
    const inspectLink = resolveInspectLink(listingId, info, asset);
    const priceCents =
      typeof info.converted_price === "number" && typeof info.converted_fee === "number"
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

const fetchMarketListings = async (
  marketHashName: string,
  limit: number,
): Promise<MarketListingItem[]> => {
  const normalizedName = marketHashName.trim();
  if (!normalizedName) return [];

  const effectiveLimit = Math.max(1, Math.min(MAX_LISTINGS_PER_ITEM, limit));
  const result: MarketListingItem[] = [];
  const seen = new Set<string>();
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
      if (seen.has(listing.listingId)) continue;
      seen.add(listing.listingId);
      result.push(listing);
      if (result.length >= effectiveLimit) break;
    }
    start += STEAM_LISTING_PAGE_SIZE;
    if (start >= total) break;
  }

  result.sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
  return result.slice(0, effectiveLimit);
};

let floatQueue: Promise<void> = Promise.resolve();
let lastFloatRequestedAt = 0;

const enqueueFloatRequest = async <T>(task: () => Promise<T>): Promise<T> => {
  const runner = async () => {
    const now = Date.now();
    const waitFor = Math.max(0, FLOAT_REQUEST_INTERVAL_MS - (now - lastFloatRequestedAt));
    if (waitFor > 0) {
      await sleep(waitFor);
    }
    try {
      const result = await task();
      return result;
    } finally {
      lastFloatRequestedAt = Date.now();
    }
  };

  const next = floatQueue.then(runner, runner);
  floatQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
};

interface CsgoFloatResponse {
  iteminfo?: {
    floatvalue?: number;
  };
  error?: string;
}

const fetchFloatForListing = async (
  listing: MarketListingItem,
): Promise<MarketListingWithFloat> => {
  if (!listing.inspectLink) {
    return { ...listing, float: null, floatError: "inspect_link_missing" };
  }

  const maxAttempts = 3;
  let attempt = 0;
  // Повторяем запрос, пока не получим float или не исчерпаем лимит попыток для
  // ошибок, не связанных с rate limit. Для 429 ждём и пытаемся снова.
  for (;;) {
    try {
      const response = await enqueueFloatRequest(() =>
        axios.get<CsgoFloatResponse>(FLOAT_API_ENDPOINT, {
          params: { url: listing.inspectLink },
          timeout: 20_000,
        }),
      );
      const floatValue = response.data?.iteminfo?.floatvalue;
      if (typeof floatValue === "number" && Number.isFinite(floatValue)) {
        return { ...listing, float: floatValue, floatError: null };
      }
      if (response.data?.error) {
        throw new Error(response.data.error);
      }
      throw new Error("float_missing");
    } catch (error: any) {
      if (isAxiosError(error) && error.response?.status === 429) {
        const retryAfterHeader = error.response.headers?.["retry-after"];
        const retryAfterSeconds = Number(retryAfterHeader);
        const delay = Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds * 1000
          : FLOAT_REQUEST_INTERVAL_MS;
        await sleep(delay);
        continue;
      }
      attempt += 1;
      if (attempt >= maxAttempts) {
        return { ...listing, float: null, floatError: String(error?.message || error) };
      }
      await sleep(FLOAT_REQUEST_INTERVAL_MS);
    }
  }

  return { ...listing, float: null, floatError: "unknown" };
};

const fetchListingsWithFloats = async (
  marketHashName: string,
  limit: number,
): Promise<MarketListingWithFloat[]> => {
  const listings = await fetchMarketListings(marketHashName, limit);
  const enriched: MarketListingWithFloat[] = [];
  for (const listing of listings) {
    enriched.push(await fetchFloatForListing(listing));
  }
  return enriched;
};

export interface TradeupAvailabilityOutcomeRequest {
  marketHashName: string;
  minFloat?: number | null;
  maxFloat?: number | null;
  rollFloat?: number | null;
}

export interface TradeupAvailabilitySlotRequest {
  index: number;
  marketHashName: string;
}

export interface TradeupAvailabilityRequest {
  outcome: TradeupAvailabilityOutcomeRequest;
  slots: TradeupAvailabilitySlotRequest[];
  limit?: number;
  targetAverageFloat?: number | null;
}

export interface TradeupAvailabilityListing extends MarketListingWithFloat {}

export interface TradeupAvailabilitySlotResult {
  index: number;
  marketHashName: string;
  listing: TradeupAvailabilityListing | null;
}

export interface TradeupAvailabilityResult {
  outcome: {
    marketHashName: string;
    minFloat: number | null;
    maxFloat: number | null;
    rollFloat: number | null;
  };
  targetAverageFloat: number | null;
  assignedAverageFloat: number | null;
  slots: TradeupAvailabilitySlotResult[];
  missingSlots: number[];
  groups: Record<string, TradeupAvailabilityListing[]>;
}

export const checkTradeupAvailability = async (
  payload: TradeupAvailabilityRequest,
): Promise<TradeupAvailabilityResult> => {
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

  const uniqueNames = new Map<string, number>();
  for (const slot of slots) {
    uniqueNames.set(slot.marketHashName, (uniqueNames.get(slot.marketHashName) ?? 0) + 1);
  }

  const listingsByName = new Map<string, TradeupAvailabilityListing[]>();
  for (const name of uniqueNames.keys()) {
    const listings = await fetchListingsWithFloats(name, limit);
    listingsByName.set(name, listings);
  }

  const providedTarget =
    typeof payload.targetAverageFloat === "number" && Number.isFinite(payload.targetAverageFloat)
      ? clamp(payload.targetAverageFloat, 0, 1)
      : null;

  const minFloat =
    typeof payload.outcome?.minFloat === "number" && Number.isFinite(payload.outcome.minFloat)
      ? payload.outcome.minFloat
      : null;
  const maxFloat =
    typeof payload.outcome?.maxFloat === "number" && Number.isFinite(payload.outcome.maxFloat)
      ? payload.outcome.maxFloat
      : null;
  const rollFloat =
    typeof payload.outcome?.rollFloat === "number" && Number.isFinite(payload.outcome.rollFloat)
      ? payload.outcome.rollFloat
      : null;

  let targetAverageFloat = providedTarget;
  if (
    targetAverageFloat == null &&
    minFloat != null &&
    maxFloat != null &&
    maxFloat > minFloat &&
    rollFloat != null
  ) {
    targetAverageFloat = clamp((rollFloat - minFloat) / (maxFloat - minFloat), 0, 1);
  }

  const comparator = (a: TradeupAvailabilityListing, b: TradeupAvailabilityListing) => {
    if (targetAverageFloat != null) {
      const diffA =
        a.float != null && Number.isFinite(a.float)
          ? Math.abs(a.float - targetAverageFloat)
          : Number.POSITIVE_INFINITY;
      const diffB =
        b.float != null && Number.isFinite(b.float)
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

  const pools = new Map<string, TradeupAvailabilityListing[]>();
  for (const [name, listings] of listingsByName.entries()) {
    pools.set(name, listings.slice().sort(comparator));
  }

  const slotResults: TradeupAvailabilitySlotResult[] = [];
  const missingSlots: number[] = [];
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
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const assignedAverageFloat = floats.length
    ? floats.reduce((sum, value) => sum + value, 0) / floats.length
    : null;

  const groups: Record<string, TradeupAvailabilityListing[]> = {};
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
