import React from "react";
import type { ParsedTradeupRow, TradeupInputFormRow } from "../types";

/**
 * Преобразует текстовые значения из формы в числовые строки trade-up.
 * Возвращает только заполненные строки с корректными float и ценой.
 */

export const useParsedRows = (rows: TradeupInputFormRow[]) => {
  return React.useMemo<ParsedTradeupRow[]>(() => {
    return rows
      .map((row) => ({
        marketHashName: row.marketHashName.trim(),
        collectionId: row.collectionId.trim(),
        float: Number.parseFloat(row.float),
        price: Number.parseFloat(row.price),
      }))
      .filter((row) => row.marketHashName && Number.isFinite(row.float));
  }, [rows]);
};
