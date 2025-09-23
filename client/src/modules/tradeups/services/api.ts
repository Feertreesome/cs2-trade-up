import type { Exterior } from "../../skins/services/types";
import { batchPriceOverview } from "../../skins/services/api";

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

export interface TradeupInputPayload {
  marketHashName: string;
  float: number;
  collectionId: string;
  priceOverrideNet?: number | null;
}

export interface TradeupOptionsPayload {
  buyerToNetRate?: number;
}

export interface TradeupCalculationPayload {
  inputs: TradeupInputPayload[];
  targetCollectionIds: string[];
  options?: TradeupOptionsPayload;
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
  inputs: TradeupInputSummaryResponse[];
  outcomes: TradeupOutcomeResponse[];
  totalInputNet: number;
  totalOutcomeNet: number;
  expectedValue: number;
  maxBudgetPerSlot: number;
  positiveOutcomeProbability: number;
  warnings: string[];
}

export async function fetchTradeupCollections() {
  const response = await fetch("/api/tradeups/collections");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { collections: TradeupCollection[] };
  return payload.collections;
}

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
