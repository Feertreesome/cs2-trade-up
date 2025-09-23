import {
  COLLECTIONS_WITH_FLOAT,
  COLLECTIONS_WITH_FLOAT_MAP,
  COVERT_FLOAT_BY_BASENAME,
  type CollectionFloatCatalogEntry,
  type CovertFloatEntry,
} from "../../../../data/CollectionsWithFloat";

export type CollectionSummary = Pick<CollectionFloatCatalogEntry, "id" | "name"> & {
  covertCount: number;
};

export type CollectionTarget = CollectionFloatCatalogEntry["skins"][number];

export interface TradeupInputItem {
  float: number;
  minFloat: number;
  maxFloat: number;
}

export interface TradeupRequest {
  collectionId: string;
  inputs: TradeupInputItem[];
}

export interface TradeupTargetResult {
  skin: CollectionTarget;
  probability: number;
  float: number;
  minFloat: number;
  maxFloat: number;
}

export interface TradeupCalculationResult {
  collection: CollectionFloatCatalogEntry;
  targets: TradeupTargetResult[];
}

let collectionsCache: CollectionSummary[] | null = null;
let targetsCache: Record<string, CollectionTarget[]> | null = null;
let covertFloatCache: Record<string, CovertFloatEntry> | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, Math.min(min, max)), Math.max(min, max));

const rebuildCaches = () => {
  collectionsCache = COLLECTIONS_WITH_FLOAT.map((collection) => ({
    id: collection.id,
    name: collection.name,
    covertCount: collection.skins.length,
  }));

  targetsCache = Object.fromEntries(
    COLLECTIONS_WITH_FLOAT.map((collection) => [
      collection.id,
      collection.skins.map((skin) => ({ ...skin })),
    ]),
  );

  covertFloatCache = { ...COVERT_FLOAT_BY_BASENAME };
};

export const refreshCollectionFloatCaches = () => {
  rebuildCaches();
  return {
    collections: collectionsCache!,
    targets: targetsCache!,
    covertByName: covertFloatCache!,
  };
};

rebuildCaches();

export const fetchSteamCollections = async (): Promise<CollectionSummary[]> => {
  if (!collectionsCache) rebuildCaches();
  return collectionsCache!.slice();
};

export const fetchCollectionTargets = async (
  collectionId: string,
): Promise<CollectionTarget[]> => {
  if (!targetsCache) rebuildCaches();
  const targets = targetsCache![collectionId];
  if (!targets) throw new Error(`Unknown collectionId: ${collectionId}`);
  return targets.slice();
};

export const getCovertFloatByBasename = (name: string): CovertFloatEntry | undefined => {
  if (!covertFloatCache) rebuildCaches();
  return covertFloatCache![name];
};

const computeTradeupOutputFloat = (
  inputs: TradeupInputItem[],
  skin: CollectionTarget,
): number => {
  if (!inputs.length) throw new Error("At least one input is required");
  const normalizedSum = inputs.reduce((sum, input) => {
    const span = input.maxFloat - input.minFloat;
    if (span <= 0) return sum;
    const clamped = clamp(input.float, input.minFloat, input.maxFloat);
    return sum + (clamped - input.minFloat) / span;
  }, 0);
  const averageNormalized = normalizedSum / inputs.length;
  const outputSpan = skin.maxFloat - skin.minFloat;
  const raw = skin.minFloat + averageNormalized * (outputSpan <= 0 ? 0 : outputSpan);
  return clamp(raw, skin.minFloat, skin.maxFloat);
};

export const calculateTradeup = async (
  request: TradeupRequest,
): Promise<TradeupCalculationResult> => {
  const collection = COLLECTIONS_WITH_FLOAT_MAP[request.collectionId];
  if (!collection) throw new Error(`Unknown collectionId: ${request.collectionId}`);
  if (!request.inputs.length) throw new Error("No inputs provided for trade-up calculation");

  const targets = collection.skins.map((skin) => ({
    skin,
    float: computeTradeupOutputFloat(request.inputs, skin),
    minFloat: skin.minFloat,
    maxFloat: skin.maxFloat,
    probability: 1 / collection.skins.length,
  }));

  return { collection, targets };
};
