import React from "react";
import type { ParsedTradeupRow, TradeupInputFormRow } from "../types";

export const useParsedRows = (rows: TradeupInputFormRow[]) => {
  return React.useMemo<ParsedTradeupRow[]>(() => {
    return rows
      .map((row) => ({
        marketHashName: row.marketHashName.trim(),
        collectionId: row.collectionId.trim(),
        float: Number.parseFloat(row.float),
        buyerPrice: Number.parseFloat(row.buyerPrice),
      }))
      .filter((row) => row.marketHashName && Number.isFinite(row.float));
  }, [rows]);
};
