import React from "react";
import {
  requestTradeupCalculation,
  type TargetRarity,
  type TradeupCalculationResponse,
} from "../../services/api";
import type { ParsedTradeupRow, RowResolution, SelectedTarget } from "../types";

interface TradeupCalculationOptions {
  buyerToNetRate: number;
  parsedRows: ParsedTradeupRow[];
  rowResolution: RowResolution;
  selectedTarget: SelectedTarget | null;
  targetRarity: TargetRarity;
  setSelectedCollectionId: (collectionId: string | null) => void;
}

export const useTradeupCalculation = ({
  buyerToNetRate,
  parsedRows,
  rowResolution,
  selectedTarget,
  targetRarity,
  setSelectedCollectionId,
}: TradeupCalculationOptions) => {
  const [calculation, setCalculation] = React.useState<TradeupCalculationResponse | null>(null);
  const [calculating, setCalculating] = React.useState(false);
  const [calculationError, setCalculationError] = React.useState<string | null>(null);

  const resetCalculation = React.useCallback(() => {
    setCalculation(null);
    setCalculationError(null);
  }, []);

  const calculate = React.useCallback(async () => {
    if (parsedRows.length === 0) {
      setCalculationError("Нужно добавить хотя бы один вход");
      return;
    }
    if (parsedRows.length !== 10) {
      setCalculationError("Trade-up требует ровно 10 входов");
      return;
    }

    if (rowResolution.unresolvedNames.length) {
      setCalculationError(
        `Не удалось определить коллекцию для: ${rowResolution.unresolvedNames
          .map((name) => `"${name}"`)
          .join(", ")}`,
      );
      return;
    }

    if (rowResolution.hasMultipleCollections) {
      setCalculationError("Trade-up должен использовать предметы из одной коллекции");
      return;
    }

    const resolvedCollectionId = rowResolution.resolvedCollectionId;

    if (!resolvedCollectionId) {
      setCalculationError("Не удалось определить коллекцию для trade-up");
      return;
    }

    setSelectedCollectionId(resolvedCollectionId);

    setCalculating(true);
    setCalculationError(null);
    try {
      const targetOverrides =
        selectedTarget && resolvedCollectionId
          ? [
              {
                collectionId: resolvedCollectionId,
                collectionTag: selectedTarget.collectionTag,
                baseName: selectedTarget.baseName,
                exterior: selectedTarget.exterior,
                marketHashName: selectedTarget.marketHashName,
                minFloat: selectedTarget.minFloat ?? null,
                maxFloat: selectedTarget.maxFloat ?? null,
                price: selectedTarget.price ?? null,
              },
            ]
          : undefined;
      const payload = {
        inputs: rowResolution.rows.map((row) => ({
          marketHashName: row.marketHashName,
          float: row.float,
          collectionId: row.resolvedCollectionId ?? resolvedCollectionId,
          priceOverrideNet: Number.isFinite(row.buyerPrice)
            ? row.buyerPrice / buyerToNetRate
            : undefined,
        })),
        targetCollectionIds: [resolvedCollectionId],
        targetRarity,
        options: { buyerToNetRate },
        targetOverrides,
      };
      const result = await requestTradeupCalculation(payload);
      setCalculation(result);
    } catch (error: any) {
      setCalculation(null);
      setCalculationError(String(error?.message || error));
    } finally {
      setCalculating(false);
    }
  }, [
    buyerToNetRate,
    parsedRows,
    rowResolution,
    selectedTarget,
    setSelectedCollectionId,
    targetRarity,
  ]);

  return {
    calculation,
    calculating,
    calculationError,
    setCalculationError,
    resetCalculation,
    calculate,
  };
};
