import type { Exterior } from "../../skins/services/types";
import type {
  CollectionInputSummary,
  CollectionInputsResponse,
  CollectionTargetsResponse,
  TargetRarity,
  TradeupAvailabilityResponse,
  TradeupCalculationResponse,
} from "../services/api";

/**
 * Основные типы, которые разделяют клиентские хуки и компоненты конструктора trade-up.
 * Содержат представления строк ввода, целевых скинов и агрегированного состояния.
 */

export interface TradeupInputFormRow {
  marketHashName: string;
  collectionId: string;
  float: string;
  price: string;
}

export interface ParsedTradeupRow {
  marketHashName: string;
  collectionId: string;
  float: number;
  price: number;
}

export interface CollectionSelectOption {
  value: string;
  label: string;
  supported: boolean;
}

export interface SelectedTarget {
  collectionTag: string;
  baseName: string;
  exterior: Exterior;
  marketHashName: string;
  minFloat?: number;
  maxFloat?: number;
  price?: number | null;
}

export interface ResolvedTradeupRow {
  marketHashName: string;
  collectionId: string;
  float: number;
  price: number;
  resolvedCollectionId: string | null;
  resolvedCollectionName: string | null;
  resolvedTag: string | null;
}

export interface RowResolution {
  rows: ResolvedTradeupRow[];
  unresolvedNames: string[];
  hasMultipleCollections: boolean;
  resolvedCollectionId: string | null;
  collectionCounts: Map<string, number>;
}

export interface TradeupBuilderState {
  steamCollections: Array<{ tag: string; name: string; collectionId: string | null }>;
  collectionOptions: CollectionSelectOption[];
  loadSteamCollections: () => void | Promise<void>;
  loadingSteamCollections: boolean;
  steamCollectionError: string | null;
  activeCollectionTag: string | null;
  targetRarity: TargetRarity;
  setTargetRarity: (rarity: TargetRarity) => void;
  selectCollection: (tag: string) => void;
  collectionTargets: CollectionTargetsResponse["targets"];
  loadingTargets: boolean;
  targetsError: string | null;
  selectedTarget: SelectedTarget | null;
  selectTarget: (
    collectionTag: string,
    baseName: string,
    exterior: CollectionTargetsResponse["targets"][number]["exteriors"][number],
  ) => void | Promise<void>;
  inputsLoading: boolean;
  inputsError: string | null;
  rows: TradeupInputFormRow[];
  updateRow: (index: number, patch: Partial<TradeupInputFormRow>) => void;
  averageFloat: number;
  totalInputCost: number;
  autofillPrices: (namesOverride?: string[]) => Promise<void> | void;
  priceLoading: boolean;
  calculate: () => Promise<void>;
  calculation: TradeupCalculationResponse | null;
  calculating: boolean;
  calculationError: string | null;
  availabilityState: TradeupAvailabilityState;
  checkAvailability: (
    outcome: TradeupCalculationResponse["outcomes"][number],
  ) => Promise<void>;
}

export interface TradeupAvailabilityState {
  activeOutcomeKey: string | null;
  loading: boolean;
  error: string | null;
  result: TradeupAvailabilityResponse | null;
  outcomeLabel: string | null;
  outcomeMarketHashName: string | null;
}
