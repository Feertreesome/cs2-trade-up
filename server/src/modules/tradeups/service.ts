import {
  COLLECTIONS_WITH_FLOAT,
  COLLECTIONS_WITH_FLOAT_MAP,
  type CollectionFloatCatalogEntry,
  type CovertFloatRange,
} from "../../../../data/CollectionsWithFloat";
import { getPriceUSD } from "../steam/repo";
import type { Exterior } from "../skins/service";

const DEFAULT_BUYER_TO_NET = 1.15;

const WEAR_BUCKETS: Array<{ exterior: Exterior; min: number; max: number }> = [
  { exterior: "Factory New", min: 0, max: 0.07 },
  { exterior: "Minimal Wear", min: 0.07, max: 0.15 },
  { exterior: "Field-Tested", min: 0.15, max: 0.38 },
  { exterior: "Well-Worn", min: 0.38, max: 0.45 },
  { exterior: "Battle-Scarred", min: 0.45, max: 1 },
];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const getExteriorByFloat = (float: number): Exterior => {
  const bucket = WEAR_BUCKETS.find((entry) => float >= entry.min && float <= entry.max);
  return bucket?.exterior ?? "Battle-Scarred";
};

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

export interface TradeupRequestPayload {
  inputs: TradeupInputSlot[];
  targetCollectionIds: string[];
  options?: TradeupOptions;
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

const toMarketHashName = (baseName: string, exterior: Exterior) =>
  `${baseName} (${exterior})`;

const buildOutcome = async (
  options: {
    averageFloat: number;
    collection: CollectionFloatCatalogEntry;
    entry: CovertFloatRange;
    collectionProbability: number;
    buyerToNetRate: number;
  },
): Promise<TradeupOutcome> => {
  const { averageFloat, collection, entry, collectionProbability, buyerToNetRate } = options;
  const raw = averageFloat * (entry.maxFloat - entry.minFloat) + entry.minFloat;
  const rollFloat = clamp(raw, entry.minFloat, entry.maxFloat);
  const exterior = getExteriorByFloat(rollFloat);
  const wearRange = getWearRange(exterior);
  const marketHashName = toMarketHashName(entry.baseName, exterior);
  const { price: buyerPrice, error } = await getPriceUSD(marketHashName);
  const netPrice = buyerPrice == null ? null : buyerPrice / buyerToNetRate;
  const probability = collectionProbability / collection.covert.length;

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    baseName: entry.baseName,
    minFloat: entry.minFloat,
    maxFloat: entry.maxFloat,
    rollFloat,
    exterior,
    wearRange: { min: wearRange.min, max: wearRange.max },
    probability,
    buyerPrice,
    netPrice,
    priceError: error,
    marketHashName,
    withinRange: rollFloat >= entry.minFloat && rollFloat <= entry.maxFloat,
  };
};

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

export const getCollectionsCatalog = (): CollectionFloatCatalogEntry[] =>
  COLLECTIONS_WITH_FLOAT.slice();

export const calculateTradeup = async (
  payload: TradeupRequestPayload,
): Promise<TradeupCalculationResult> => {
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
