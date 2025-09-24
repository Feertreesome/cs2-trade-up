import type { Exterior } from "../../skins/services/types";
import { batchPriceOverview } from "../../skins/services/api";

/**
 * Клиентский слой работы с trade-up API. Предоставляет функции для загрузки коллекций,
 * целей, входов и для отправки данных на расчёт EV.
 */

export interface CovertFloatRange {
  baseName: string;
  minFloat: number;
  maxFloat: number;
}

export interface TradeupCollection {
  id: string;
  name: string;
  covert: CovertFloatRange[];
}

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
  inputs: CollectionInputSummary[];
}

export interface TradeupInputPayload {
  marketHashName: string;
  exterior: Exterior;
  collectionId: string;
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
  options?: TradeupOptionsPayload;
  targetOverrides?: TradeupTargetOverridePayload[];
}

export interface TradeupOutcomeWearResponse {
  exterior: Exterior;
  range: { min: number; max: number };
  share: number;
  marketHashName: string;
  buyerPrice?: number | null;
  netPrice?: number | null;
  priceError?: unknown;
}

export interface TradeupOutcomeResponse {
  collectionId: string;
  collectionName: string;
  baseName: string;
  floatRange: { min: number; max: number };
  probability: number;
  wears: TradeupOutcomeWearResponse[];
  worstBuyer?: number | null;
  expectedBuyer?: number | null;
  worstNet?: number | null;
  expectedNet?: number | null;
}

export interface TradeupInputSummaryResponse extends TradeupInputPayload {
  priceMarket?: number | null;
  netPrice?: number | null;
  priceError?: unknown;
}

export interface TradeupCalculationResponse {
  averageRange: { min: number; max: number };
  inputs: TradeupInputSummaryResponse[];
  outcomes: TradeupOutcomeResponse[];
  totalInputNet: number;
  expectedOutcomeNet: number;
  worstOutcomeNet: number;
  expectedValue: number;
  worstValue: number;
  maxBudgetPerSlotExpected: number;
  maxBudgetPerSlotWorst: number;
  positiveOutcomeProbabilityExpected: number;
  positiveOutcomeProbabilityWorst: number;
  warnings: string[];
}

/** Загружает локальный справочник коллекций с float-диапазонами. */
export async function fetchTradeupCollections() {
  const response = await fetch("/api/tradeups/collections");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { collections: TradeupCollection[] };
  return payload.collections;
}

/** Запрашивает живой список коллекций из Steam (возвращает теги и статистику). */
export async function fetchSteamCollections() {
  const response = await fetch("/api/tradeups/collections/steam");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { collections: SteamCollectionSummary[] };
  return payload.collections;
}

/** Получает список Covert-результатов для конкретного Steam tag'а. */
export async function fetchCollectionTargets(collectionTag: string) {
  const response = await fetch(`/api/tradeups/collections/${encodeURIComponent(collectionTag)}/targets`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as CollectionTargetsResponse;
}

/** Выгружает Classified-входы для коллекции (используется при автозаполнении таблицы). */
export async function fetchCollectionInputs(collectionTag: string) {
  const response = await fetch(`/api/tradeups/collections/${encodeURIComponent(collectionTag)}/inputs`);
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

export { batchPriceOverview };
