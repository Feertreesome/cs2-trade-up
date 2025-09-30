import type { Exterior } from "../../skins/services/types";
import type {
  CollectionInputSummary,
  CollectionTargetsResponse,
  TargetRarity,
  TradeupCalculationResponse,
  TradeupCollection,
} from "../services/api";

export interface TradeupInputFormRow {
  marketHashName: string;
  collectionId: string;
  float: string;
  buyerPrice: string;
}

export interface ParsedTradeupRow {
  marketHashName: string;
  collectionId: string;
  float: number;
  buyerPrice: number;
}

export interface CollectionSelectOption {
  value: string;
  label: string;
  supported: boolean;
}

export interface CollectionValueMeta {
  collectionId: string | null;
  tag: string | null;
  name: string;
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
  buyerPrice: number;
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

export interface FloatlessOutcomeExterior {
  exterior: Exterior;
  probability: number | null;
  buyerPrice: number | null;
  netPrice: number | null;
  marketHashName: string;
}

export interface FloatlessOutcomeSummary {
  baseName: string;
  probability: number;
  projectedRange: { min: number; max: number };
  exteriors: FloatlessOutcomeExterior[];
  robustNet: number | null;
  expectedNetContribution: number | null;
  expectedProbabilityCovered: number;
}

export interface FloatlessAnalysisResult {
  ready: boolean;
  issues: string[];
  inputRange: { min: number; max: number } | null;
  wearCounts: Partial<Record<Exterior, number>>;
  outcomes: FloatlessOutcomeSummary[];
  robustOutcomeNet: number | null;
  expectedOutcomeNet: number | null;
  robustEV: number | null;
  expectedEV: number | null;
  expectedCoverage: number;
}

export interface CollectionLookupContext {
  catalogCollections: TradeupCollection[];
  catalogMap: Map<string, TradeupCollection>;
  steamCollections: Array<{ tag: string; name: string; collectionId: string | null }>;
  steamCollectionsByTag: Map<string, { tag: string; name: string; collectionId: string | null }>;
  targetsByCollection: Record<string, Partial<Record<TargetRarity, CollectionTargetsResponse>>>;
  inputsByCollection: Record<
    string,
    { collectionId: string | null; collectionTag: string; inputs: CollectionInputSummary[] }
  >;
}

export interface TradeupBuilderState {
  catalogCollections: TradeupCollection[];
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
  buyerFeePercent: number;
  setBuyerFeePercent: React.Dispatch<React.SetStateAction<number>>;
  buyerToNetRate: number;
  averageFloat: number;
  totalBuyerCost: number;
  totalNetCost: number;
  selectedCollectionDetails: TradeupCollection[];
  autofillPrices: (namesOverride?: string[]) => Promise<void> | void;
  priceLoading: boolean;
  calculate: () => Promise<void>;
  calculation: TradeupCalculationResponse | null;
  calculating: boolean;
  calculationError: string | null;
  floatlessAnalysis: FloatlessAnalysisResult;
}
