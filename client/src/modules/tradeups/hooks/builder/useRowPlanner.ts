import React from "react";
import { planRowsForCollection } from "../rowPlanning";
import type { CollectionInputSummary } from "../../services/api";
import type { Exterior } from "../../skins/services/types";
import type { TradeupInputFormRow } from "../types";

/**
 * Применяет подсказки коллекции к таблице входов: задаёт float/цены и при необходимости
 * запускает автоподбор недостающих стоимостей из Steam.
 */
interface RowPlannerOptions {
  selectedCollectionId: string | null;
  setRows: React.Dispatch<React.SetStateAction<TradeupInputFormRow[]>>;
  autofillPrices: (namesOverride?: string[]) => Promise<void> | void;
}

interface ApplyInputsOptions {
  collectionTag: string;
  collectionId: string | null;
  inputs: CollectionInputSummary[];
  targetOptions?: {
    exterior: Exterior;
    minFloat?: number | null;
    maxFloat?: number | null;
  };
}

export const useRowPlanner = ({
  selectedCollectionId,
  setRows,
  autofillPrices,
}: RowPlannerOptions) => {
  return React.useCallback(
    async ({ collectionTag, collectionId, inputs, targetOptions }: ApplyInputsOptions) => {
      const { rows: plannedRows, missingNames } = planRowsForCollection({
        collectionTag,
        collectionId,
        selectedCollectionId,
        inputs,
        options: targetOptions
          ? {
              target: {
                exterior: targetOptions.exterior,
                minFloat: targetOptions.minFloat ?? null,
                maxFloat: targetOptions.maxFloat ?? null,
              },
            }
          : undefined,
      });
      setRows(plannedRows);
      if (missingNames.length) {
        await autofillPrices(missingNames);
      }
    },
    [autofillPrices, selectedCollectionId, setRows],
  );
};
