import React from "react";
import {
  batchPriceOverview,
  fetchTradeupCollections,
  requestTradeupCalculation,
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

const INITIAL_ROWS = Array.from({ length: 10 }, makeEmptyRow);

export default function useTradeupBuilder() {
  const [collections, setCollections] = React.useState<TradeupCollection[]>([]);
  const [loadingCollections, setLoadingCollections] = React.useState(true);
  const [collectionError, setCollectionError] = React.useState<string | null>(null);

  const [selectedCollections, setSelectedCollections] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<TradeupInputFormRow[]>(INITIAL_ROWS);
  const [buyerFeePercent, setBuyerFeePercent] = React.useState<number>(15);

  const [calculation, setCalculation] = React.useState<TradeupCalculationResponse | null>(null);
  const [calculating, setCalculating] = React.useState(false);
  const [calculationError, setCalculationError] = React.useState<string | null>(null);
  const [priceLoading, setPriceLoading] = React.useState(false);

  const buyerToNetRate = 1 + Math.max(0, buyerFeePercent) / 100;

  React.useEffect(() => {
    async function loadCollections() {
      try {
        setCollectionError(null);
        const list = await fetchTradeupCollections();
        setCollections(list);
      } catch (error: any) {
        setCollectionError(String(error?.message || error));
      } finally {
        setLoadingCollections(false);
      }
    }
    void loadCollections();
  }, []);

  const updateRow = React.useCallback(
    (index: number, patch: Partial<TradeupInputFormRow>) => {
      setRows((prev) => {
        const next = prev.slice();
        next[index] = { ...next[index], ...patch };
        return next;
      });
    },
  []);

  const toggleCollection = React.useCallback((collectionId: string) => {
    setSelectedCollections((prev) =>
      prev.includes(collectionId)
        ? prev.filter((id) => id !== collectionId)
        : [...prev, collectionId],
    );
  }, []);

  const parsedRows = React.useMemo(() => {
    return rows
      .map((row) => ({
        marketHashName: row.marketHashName.trim(),
        collectionId: row.collectionId,
        float: Number.parseFloat(row.float),
        buyerPrice: Number.parseFloat(row.buyerPrice),
      }))
      .filter((row) => row.marketHashName && row.collectionId && Number.isFinite(row.float));
  }, [rows]);

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

  const collectionMap = React.useMemo(() => {
    const map = new Map(collections.map((collection) => [collection.id, collection] as const));
    return map;
  }, [collections]);

  const selectedCollectionDetails = React.useMemo(
    () => selectedCollections.map((id) => collectionMap.get(id)).filter(Boolean),
    [collectionMap, selectedCollections],
  );

  const autofillPrices = React.useCallback(async () => {
    const names = Array.from(new Set(rows.map((row) => row.marketHashName).filter(Boolean)));
    if (!names.length) return;
    try {
      setPriceLoading(true);
      const prices = await batchPriceOverview(names);
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
  }, [rows]);

  const calculate = React.useCallback(async () => {
    if (parsedRows.length === 0) {
      setCalculationError("Нужно добавить хотя бы один вход");
      return;
    }
    if (parsedRows.length !== 10) {
      setCalculationError("Trade-up требует ровно 10 входов");
      return;
    }
    if (!selectedCollections.length) {
      setCalculationError("Выберите целевые коллекции");
      return;
    }
    setCalculating(true);
    setCalculationError(null);
    try {
      const payload = {
        inputs: parsedRows.map((row) => ({
          marketHashName: row.marketHashName,
          float: row.float,
          collectionId: row.collectionId,
          priceOverrideNet: Number.isFinite(row.buyerPrice)
            ? row.buyerPrice / buyerToNetRate
            : undefined,
        })),
        targetCollectionIds: selectedCollections,
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
  }, [parsedRows, selectedCollections, buyerToNetRate]);

  return {
    collections,
    loadingCollections,
    collectionError,
    selectedCollections,
    toggleCollection,
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
