/**
 * Модуль бизнес-логики trade-up калькулятора. Содержит функции, которые
 * переиспользуются в HTTP-роутере и в клиентском приложении через API.
 * Здесь же реализованы вспомогательные структуры и кеши для сопоставления
 * коллекций Steam с нашим справочником float-диапазонов.
 */
import {
  COLLECTIONS_WITH_FLOAT,
  COLLECTIONS_WITH_FLOAT_MAP,
  COLLECTIONS_WITH_FLOAT_BY_NAME,
  COVERT_FLOAT_BY_BASENAME,
  rebuildCollectionFloatCaches,
  type CollectionFloatCatalogEntry,
  type CovertFloatRange,
} from "../../../../data/CollectionsWithFloat";
import { STEAM_MAX_AUTO_LIMIT, STEAM_PAGE_SIZE } from "../../config";
import {
  fetchCollectionTags,
  getPriceUSD,
  searchByCollection,
  RARITY_TO_TAG,
  type SearchItem,
  type SteamCollectionTag,
} from "../steam/repo";
import {
  baseFromMarketHash,
  parseMarketHashExterior,
  type Exterior,
} from "../skins/service";

const DEFAULT_BUYER_TO_NET = 1.15;

const WEAR_BUCKETS: Array<{ exterior: Exterior; min: number; max: number }> = [
  { exterior: "Factory New", min: 0, max: 0.07 },
  { exterior: "Minimal Wear", min: 0.07, max: 0.15 },
  { exterior: "Field-Tested", min: 0.15, max: 0.38 },
  { exterior: "Well-Worn", min: 0.38, max: 0.45 },
  { exterior: "Battle-Scarred", min: 0.45, max: 1 },
];

/** Ограничивает значение указанным диапазоном. */
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Возвращает наименование степени износа, соответствующее float-значению. */
const getExteriorByFloat = (float: number): Exterior => {
  const bucket = WEAR_BUCKETS.find((entry) => float >= entry.min && float <= entry.max);
  return bucket?.exterior ?? "Battle-Scarred";
};

/** Находит числовой диапазон wear-ступени. */
const getWearRange = (exterior: Exterior) =>
  WEAR_BUCKETS.find((entry) => entry.exterior === exterior) ?? WEAR_BUCKETS[WEAR_BUCKETS.length - 1];

export interface TradeupInputSlot {
  marketHashName: string;
  float: number;
  /** Идентификатор коллекции, к которой относится входной предмет. */
  collectionId: string;
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
    averageFloat: number;
    collection: CollectionFloatCatalogEntry;
    entry: CovertFloatRange;
    collectionProbability: number;
    buyerToNetRate: number;
    override?: TargetOverrideRequest;
  },
): Promise<TradeupOutcome> => {
  const { averageFloat, collection, entry, collectionProbability, buyerToNetRate, override } =
    options;

  const resolvedMin = clamp(override?.minFloat ?? entry.minFloat, 0, 1);
  const resolvedMax = clamp(override?.maxFloat ?? entry.maxFloat, 0, 1);
  const minFloat = Math.min(resolvedMin, resolvedMax);
  const maxFloat = Math.max(resolvedMin, resolvedMax);
  const raw = averageFloat * (maxFloat - minFloat) + minFloat;
  const rollFloat = clamp(raw, minFloat, maxFloat);
  const exterior = getExteriorByFloat(rollFloat);
  const wearRange = getWearRange(exterior);

  const fallbackMarketHashName = toMarketHashName(entry.baseName, exterior);
  const overrideMatchesBase =
    override?.marketHashName &&
    baseFromMarketHash(override.marketHashName) === entry.baseName &&
    parseMarketHashExterior(override.marketHashName) === exterior;
  const marketHashName = overrideMatchesBase ? override.marketHashName : fallbackMarketHashName;

  let buyerPrice = overrideMatchesBase && override?.price != null ? override.price : null;
  let priceError: unknown = undefined;
  if (buyerPrice == null) {
    const { price, error } = await getPriceUSD(marketHashName);
    buyerPrice = price;
    priceError = error;
  }

  const netPrice = buyerPrice == null ? null : buyerPrice / buyerToNetRate;
  const probability = collectionProbability / collection.covert.length;

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
    if (entry.covert.some((covert) => baseNames.includes(covert.baseName))) {
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
  targets: CollectionTargetSummary[];
}

/**
 * Загружает Covert-предметы коллекции, группирует их по базовому названию и дополняет float-диапазоном.
 */
export const fetchCollectionTargets = async (
  collectionTag: string,
): Promise<CollectionTargetsResult> => {
  ensureCollectionCaches();
  const items = await fetchEntireCollection({ collectionTag, rarity: "Covert" });
  const grouped = new Map<string, CollectionTargetSummary>();
  const baseNames: string[] = [];

  for (const item of items) {
    const exterior = parseMarketHashExterior(item.market_hash_name);
    const baseName = baseFromMarketHash(item.market_hash_name);
    const floats = COVERT_FLOAT_BY_BASENAME.get(baseName);

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
  inputs: CollectionInputSummary[];
}

/**
 * Получает список Classified-предметов коллекции, которые могут служить входами.
 */
export const fetchCollectionInputs = async (
  collectionTag: string,
): Promise<CollectionInputsResult> => {
  ensureCollectionCaches();
  const items = await fetchEntireCollection({
    collectionTag,
    rarity: "Classified",
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

  return { collectionTag, collectionId, inputs };
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

  const targetCollections = payload.targetCollectionIds
    .map((id) => COLLECTIONS_WITH_FLOAT_MAP.get(id))
    .filter((collection): collection is CollectionFloatCatalogEntry => Boolean(collection));

  if (!targetCollections.length) {
    throw new Error("No valid target collections specified");
  }

  const outcomes = await Promise.all(
    targetCollections.flatMap((collection) => {
      const collectionProbability = (collectionCounts.get(collection.id) ?? 0) / totalInputs;
      return collection.covert.map((entry) =>
        buildOutcome({
          averageFloat,
          collection,
          entry,
          collectionProbability,
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
  for (const outcome of outcomes) {
    if (!outcome.withinRange) {
      warnings.push(
        `${outcome.baseName} roll float ${outcome.rollFloat.toFixed(4)} is outside declared range`,
      );
    }
  }

  return {
    averageFloat,
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
