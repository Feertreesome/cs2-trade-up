import React from "react";
import type { Exterior } from "../../skins/services/types";
import {
  batchPriceOverview,
  fetchCollectionInputs,
  fetchCollectionTargets,
  fetchSteamCollections,
  fetchTradeupCollections,
  requestTradeupCalculation,
  type CollectionInputSummary,
  type CollectionTargetExterior,
  type CollectionTargetsResponse,
  type SteamCollectionSummary,
  type TradeupCalculationResponse,
  type TradeupCollection,
} from "../services/api";

export interface TradeupInputFormRow {
  marketHashName: string;
  collectionId: string;
  float: string;
  buyerPrice: string;
}

const makeEmptyRow = (): TradeupInputFormRow => ({
  marketHashName: "",
  collectionId: "",
  float: "",
  buyerPrice: "",
});

const createInitialRows = () => Array.from({ length: 10 }, makeEmptyRow);

const EXTERIOR_FLOAT_RANGES: Record<Exterior, { min: number; max: number }> = {
  "Factory New": { min: 0, max: 0.07 },
  "Minimal Wear": { min: 0.07, max: 0.15 },
  "Field-Tested": { min: 0.15, max: 0.38 },
  "Well-Worn": { min: 0.38, max: 0.45 },
  "Battle-Scarred": { min: 0.45, max: 1 },
};

const defaultFloatForExterior = (exterior: Exterior) => {
  const range = EXTERIOR_FLOAT_RANGES[exterior];
  if (!range) return "";
  const midpoint = (range.min + range.max) / 2;
  return midpoint.toFixed(5);
};

interface SelectedTarget {
  collectionTag: string;
  baseName: string;
  exterior: Exterior;
  marketHashName: string;
  minFloat?: number;
  maxFloat?: number;
}

export default function useTradeupBuilder() {
  const [catalogCollections, setCatalogCollections] = React.useState<TradeupCollection[]>([]);
  const [steamCollections, setSteamCollections] = React.useState<SteamCollectionSummary[]>([]);
  const [loadingSteamCollections, setLoadingSteamCollections] = React.useState(false);
  const [steamCollectionError, setSteamCollectionError] = React.useState<string | null>(null);

  const [activeCollectionTag, setActiveCollectionTag] = React.useState<string | null>(null);
  const [targetsByCollection, setTargetsByCollection] = React.useState<
    Record<string, CollectionTargetsResponse>
  >({});
  const [loadingTargets, setLoadingTargets] = React.useState(false);
  const [targetsError, setTargetsError] = React.useState<string | null>(null);

  const [inputsByCollection, setInputsByCollection] = React.useState<
    Record<string, { collectionId: string | null; inputs: CollectionInputSummary[] }>
  >({});
  const [inputsLoading, setInputsLoading] = React.useState(false);
  const [inputsError, setInputsError] = React.useState<string | null>(null);

  const [selectedTarget, setSelectedTarget] = React.useState<SelectedTarget | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = React.useState<string | null>(null);

  const [rows, setRows] = React.useState<TradeupInputFormRow[]>(() => createInitialRows());
  const [buyerFeePercent, setBuyerFeePercent] = React.useState<number>(15);

  const [calculation, setCalculation] = React.useState<TradeupCalculationResponse | null>(null);
  const [calculating, setCalculating] = React.useState(false);
  const [calculationError, setCalculationError] = React.useState<string | null>(null);
  const [priceLoading, setPriceLoading] = React.useState(false);

  const buyerToNetRate = 1 + Math.max(0, buyerFeePercent) / 100;

  React.useEffect(() => {
    async function loadCatalog() {
      try {
        const list = await fetchTradeupCollections();
        setCatalogCollections(list);
      } catch (error) {
        console.error("Failed to load trade-up catalog", error);
      }
    }
    void loadCatalog();
  }, []);

  const catalogMap = React.useMemo(() => {
    return new Map(catalogCollections.map((collection) => [collection.id, collection] as const));
  }, [catalogCollections]);

  const selectedCollectionDetails = React.useMemo(() => {
    if (!selectedCollectionId) return [];
    const entry = catalogMap.get(selectedCollectionId);
    return entry ? [entry] : [];
  }, [catalogMap, selectedCollectionId]);

  const loadSteamCollections = React.useCallback(async () => {
    try {
      setSteamCollectionError(null);
      setLoadingSteamCollections(true);
      const list = await fetchSteamCollections();
      setSteamCollections(list);
    } catch (error: any) {
      setSteamCollectionError(String(error?.message || error));
    } finally {
      setLoadingSteamCollections(false);
    }
  }, []);

  const activeTargets = React.useMemo(() => {
    if (!activeCollectionTag) return [];
    return targetsByCollection[activeCollectionTag]?.targets ?? [];
  }, [activeCollectionTag, targetsByCollection]);

  const selectCollection = React.useCallback(
    async (collectionTag: string) => {
      setActiveCollectionTag(collectionTag);
      setTargetsError(null);
      setInputsError(null);
      setSelectedTarget(null);
      setCalculation(null);
      setRows(createInitialRows());
      setSelectedCollectionId(null);

      if (targetsByCollection[collectionTag]) {
        const cached = targetsByCollection[collectionTag];
        if (cached.collectionId) setSelectedCollectionId(cached.collectionId);
        return;
      }

      try {
        setLoadingTargets(true);
        const result = await fetchCollectionTargets(collectionTag);
        setTargetsByCollection((prev) => ({ ...prev, [collectionTag]: result }));
        if (result.collectionId) setSelectedCollectionId(result.collectionId);
      } catch (error: any) {
        setTargetsError(String(error?.message || error));
      } finally {
        setLoadingTargets(false);
      }
    },
    [targetsByCollection],
  );

  const loadInputsForCollection = React.useCallback(
    async (collectionTag: string) => {
      const cached = inputsByCollection[collectionTag];
      if (cached) {
        setInputsError(null);
        return cached;
      }
      try {
        setInputsLoading(true);
        setInputsError(null);
        const result = await fetchCollectionInputs(collectionTag);
        setInputsByCollection((prev) => ({ ...prev, [collectionTag]: result }));
        return result;
      } catch (error: any) {
        setInputsError(String(error?.message || error));
        throw error;
      } finally {
        setInputsLoading(false);
      }
    },
    [inputsByCollection],
  );

  const autofillPrices = React.useCallback(
    async (namesOverride?: string[]) => {
      const lookupNames =
        namesOverride ??
        Array.from(new Set(rows.map((row) => row.marketHashName).filter(Boolean)));
      if (!lookupNames.length) return;
      try {
        setPriceLoading(true);
        const prices = await batchPriceOverview(lookupNames);
        setRows((prev) =>
          prev.map((row) => {
            const price = prices[row.marketHashName];
            if (typeof price === "number") {
              return { ...row, buyerPrice: price.toFixed(2) };
            }
            return row;
          }),
        );
      } catch (error: any) {
        setCalculationError(String(error?.message || error));
      } finally {
        setPriceLoading(false);
      }
    },
    [rows],
  );

  const applyInputsToRows = React.useCallback(
    async (collectionId: string | null, inputs: CollectionInputSummary[]) => {
      const trimmed = inputs.slice(0, 10);
      const filled: TradeupInputFormRow[] = trimmed.map((input) => ({
        marketHashName: input.marketHashName,
        collectionId: collectionId ?? "",
        float: defaultFloatForExterior(input.exterior),
        buyerPrice: input.price != null ? input.price.toFixed(2) : "",
      }));
      while (filled.length < 10) filled.push(makeEmptyRow());
      setRows(filled);

      const missingNames = trimmed
        .filter((input) => input.price == null)
        .map((input) => input.marketHashName);
      if (missingNames.length) {
        await autofillPrices(missingNames);
      }
    },
    [autofillPrices],
  );

  const selectTarget = React.useCallback(
    async (
      collectionTag: string,
      baseName: string,
      exterior: CollectionTargetExterior,
    ) => {
      setSelectedTarget({
        collectionTag,
        baseName,
        exterior: exterior.exterior,
        marketHashName: exterior.marketHashName,
        minFloat: exterior.minFloat,
        maxFloat: exterior.maxFloat,
      });
      setCalculation(null);
      setCalculationError(null);
      try {
        const response = await loadInputsForCollection(collectionTag);
        const collectionId = response.collectionId ?? selectedCollectionId;
        if (response.collectionId) setSelectedCollectionId(response.collectionId);
        await applyInputsToRows(collectionId ?? null, response.inputs);
      } catch (error) {
        // handled in loadInputsForCollection
      }
    },
    [applyInputsToRows, loadInputsForCollection, selectedCollectionId],
  );

  const updateRow = React.useCallback(
    (index: number, patch: Partial<TradeupInputFormRow>) => {
      setRows((prev) => {
        const next = prev.slice();
        next[index] = { ...next[index], ...patch };
        return next;
      });
    },
  []);

  const parsedRows = React.useMemo(() => {
    return rows
      .map((row) => ({
        marketHashName: row.marketHashName.trim(),
        collectionId: row.collectionId || selectedCollectionId || "",
        float: Number.parseFloat(row.float),
        buyerPrice: Number.parseFloat(row.buyerPrice),
      }))
      .filter((row) => row.marketHashName && Number.isFinite(row.float));
  }, [rows, selectedCollectionId]);

  const averageFloat = React.useMemo(() => {
    if (!parsedRows.length) return 0;
    const sum = parsedRows.reduce((acc, row) => acc + row.float, 0);
    return sum / parsedRows.length;
  }, [parsedRows]);

  const totalBuyerCost = React.useMemo(() => {
    return parsedRows.reduce(
      (sum, row) => sum + (Number.isFinite(row.buyerPrice) ? row.buyerPrice : 0),
      0,
    );
  }, [parsedRows]);

  const totalNetCost = totalBuyerCost / buyerToNetRate;

  const calculate = React.useCallback(async () => {
    if (parsedRows.length === 0) {
      setCalculationError("Нужно добавить хотя бы один вход");
      return;
    }
    if (parsedRows.length !== 10) {
      setCalculationError("Trade-up требует ровно 10 входов");
      return;
    }
    if (!selectedCollectionId) {
      setCalculationError("Не удалось определить коллекцию для trade-up");
      return;
    }
    setCalculating(true);
    setCalculationError(null);
    try {
      const payload = {
        inputs: parsedRows.map((row) => ({
          marketHashName: row.marketHashName,
          float: row.float,
          collectionId: row.collectionId || selectedCollectionId,
          priceOverrideNet: Number.isFinite(row.buyerPrice)
            ? row.buyerPrice / buyerToNetRate
            : undefined,
        })),
        targetCollectionIds: [selectedCollectionId],
        options: { buyerToNetRate },
      };
      const result = await requestTradeupCalculation(payload);
      setCalculation(result);
    } catch (error: any) {
      setCalculation(null);
      setCalculationError(String(error?.message || error));
    } finally {
      setCalculating(false);
    }
  }, [parsedRows, selectedCollectionId, buyerToNetRate]);

  return {
    catalogCollections,
    steamCollections,
    loadSteamCollections,
    loadingSteamCollections,
    steamCollectionError,
    activeCollectionTag,
    selectCollection,
    collectionTargets: activeTargets,
    loadingTargets,
    targetsError,
    selectedTarget,
    selectTarget,
    inputsLoading,
    inputsError,
    rows,
    updateRow,
    buyerFeePercent,
    setBuyerFeePercent,
    buyerToNetRate,
    averageFloat,
    totalBuyerCost,
    totalNetCost,
    selectedCollectionDetails,
    autofillPrices,
    priceLoading,
    calculate,
    calculation,
    calculating,
    calculationError,
  };
}
