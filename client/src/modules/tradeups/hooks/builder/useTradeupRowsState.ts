import React from "react";
import { createInitialRows } from "../helpers";
import type { TradeupInputFormRow } from "../types";

/**
 * Управляет массивом строк ввода trade-up'а и предоставляет утилиты для сброса/обновления.
 */

interface TradeupRowsState {
  rows: TradeupInputFormRow[];
  setRows: React.Dispatch<React.SetStateAction<TradeupInputFormRow[]>>;
  resetRows: () => void;
  updateRow: (index: number, patch: Partial<TradeupInputFormRow>) => void;
}

export function useTradeupRowsState(): TradeupRowsState {
  const [rows, setRows] = React.useState<TradeupInputFormRow[]>(() => createInitialRows());

  const resetRows = React.useCallback(() => {
    setRows(() => createInitialRows());
  }, []);

  const updateRow = React.useCallback(
    (index: number, patch: Partial<TradeupInputFormRow>) => {
      setRows((prev) => {
        if (index < 0 || index >= prev.length) {
          return prev;
        }
        const next = prev.slice();
        next[index] = { ...next[index], ...patch };
        return next;
      });
    },
    [],
  );

  return { rows, setRows, resetRows, updateRow };
}
