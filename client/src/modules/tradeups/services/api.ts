import type { Exterior } from "../../skins/services/types";
import { batchPriceOverview } from "../../skins/services/api";

export type TargetRarity =
  | "Consumer"
  | "Industrial"
  | "Mil-Spec"
  | "Restricted"
  | "Classified"
  | "Covert";

/**
 * Клиентский слой работы с trade-up API. Предоставляет функции для загрузки коллекций,
 * целей, входов и для отправки данных на расчёт EV.
 */

export interface CollectionFloatRange {
  baseName: string;
  minFloat: number;
  maxFloat: number;
}

export type CovertFloatRange = CollectionFloatRange;

export type ClassifiedFloatRange = CollectionFloatRange;

export interface SteamCollectionSummary {
  tag: string;
  name: string;
  count: number;
  collectionId: string | null;
}

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

export interface CollectionTargetsResponse {
  collectionTag: string;
  collectionId: string | null;
  rarity: TargetRarity;
  targets: CollectionTargetSummary[];
}

export interface CollectionInputSummary {
  baseName: string;
  marketHashName: string;
  exterior: Exterior;
  price?: number | null;
}

export interface CollectionInputsResponse {
  collectionTag: string;
  collectionId: string | null;
  rarity: TargetRarity | null;
  inputs: CollectionInputSummary[];
}

export interface SyncJobProgress {
  totalCollections: number;
  syncedCollections: number;
  currentCollectionTag?: string;
  currentCollectionName?: string;
  currentRarity?: string;
}

export interface SyncJobStatus {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
  progress: SyncJobProgress;
}

export interface TradeupInputPayload {
  marketHashName: string;
  float: number;
  collectionId: string;
  minFloat?: number | null;
  maxFloat?: number | null;
  priceOverrideNet?: number | null;
}

export interface TradeupOptionsPayload {
  buyerToNetRate?: number;
}

export interface TradeupTargetOverridePayload {
  collectionId?: string | null;
  collectionTag?: string | null;
  baseName: string;
  exterior?: Exterior | null;
  marketHashName?: string | null;
  minFloat?: number | null;
  maxFloat?: number | null;
  price?: number | null;
}

export interface TradeupCalculationPayload {
  inputs: TradeupInputPayload[];
  targetCollectionIds: string[];
  targetRarity?: TargetRarity;
  options?: TradeupOptionsPayload;
  targetOverrides?: TradeupTargetOverridePayload[];
}

export interface TradeupOutcomeResponse {
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

export interface TradeupInputSummaryResponse extends TradeupInputPayload {
  priceMarket?: number | null;
  netPrice?: number | null;
  priceError?: unknown;
}

export interface TradeupCalculationResponse {
  averageFloat: number;
  normalizedAverageFloat: number;
  normalizationMode: "normalized" | "simple";
  inputs: TradeupInputSummaryResponse[];
  outcomes: TradeupOutcomeResponse[];
  totalInputNet: number;
  totalOutcomeNet: number;
  expectedValue: number;
  maxBudgetPerSlot: number;
  positiveOutcomeProbability: number;
  warnings: string[];
}

export interface TradeupAvailabilityOutcomePayload {
  marketHashName: string;
  minFloat?: number | null;
  maxFloat?: number | null;
  rollFloat?: number | null;
}

export interface TradeupAvailabilitySlotPayload {
  index: number;
  marketHashName: string;
}

export interface TradeupAvailabilityRequestPayload {
  outcome: TradeupAvailabilityOutcomePayload;
  slots: TradeupAvailabilitySlotPayload[];
  limit?: number;
  targetAverageFloat?: number | null;
}

export interface TradeupAvailabilityListing {
  listingId: string | null;
  assetId: string | null;
  marketHashName: string;
  price: number | null;
  float: number | null;
  floatError?: string | null;
  inspectLink: string | null;
  sellerId: string | null;
}

export interface TradeupAvailabilitySlotResult {
  index: number;
  marketHashName: string;
  listing: TradeupAvailabilityListing | null;
}

export interface TradeupAvailabilityResponse {
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

/** Загружает локальный справочник коллекций с float-диапазонами. */
/** Запрашивает живой список коллекций из Steam (возвращает теги и статистику). */
export async function fetchSteamCollections() {
  const response = await fetch("/api/tradeups/collections/steam");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { collections: SteamCollectionSummary[] };
  return payload.collections;
}

/** Получает список результатов указанной редкости для конкретного Steam tag'а. */
export async function fetchCollectionTargets(collectionTag: string, rarity: TargetRarity = "Covert") {
  const qs = new URLSearchParams({ rarity });
  const response = await fetch(
    `/api/tradeups/collections/${encodeURIComponent(collectionTag)}/targets?${qs.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as CollectionTargetsResponse;
}

/** Выгружает входы для коллекции (используется при автозаполнении таблицы). */
export async function fetchCollectionInputs(
  collectionTag: string,
  targetRarity: TargetRarity = "Covert",
) {
  const qs = new URLSearchParams({ rarity: targetRarity });
  const response = await fetch(
    `/api/tradeups/collections/${encodeURIComponent(collectionTag)}/inputs?${qs.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as CollectionInputsResponse;
}

/** Отправляет состав trade-up'а на сервер для расчёта EV и вероятностей. */
export async function requestTradeupCalculation(payload: TradeupCalculationPayload) {
  const response = await fetch("/api/tradeups/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return (await response.json()) as TradeupCalculationResponse;
}

export async function requestTradeupAvailability(payload: TradeupAvailabilityRequestPayload) {
  const response = await fetch("/api/tradeups/availability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return (await response.json()) as TradeupAvailabilityResponse;
}

export async function requestCollectionsSync() {
  const response = await fetch("/api/tradeups/collections/sync", {
    method: "POST",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return (await response.json()) as { job: SyncJobStatus };
}

export async function fetchCollectionsSyncStatus() {
  const response = await fetch("/api/tradeups/collections/sync");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return (await response.json()) as {
    active: SyncJobStatus | null;
    jobs: SyncJobStatus[];
  };
}

export { batchPriceOverview };
