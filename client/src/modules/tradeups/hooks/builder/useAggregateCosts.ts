import React from "react";
import type { ParsedTradeupRow } from "../types";

export const useAggregateCosts = (
  parsedRows: ParsedTradeupRow[],
  buyerToNetRate: number,
) => {
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

  return { averageFloat, totalBuyerCost, totalNetCost } as const;
};
