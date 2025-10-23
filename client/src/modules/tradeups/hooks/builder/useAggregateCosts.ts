import React from "react";
import type { ParsedTradeupRow } from "../types";

/**
 * Считает агрегированные показатели по текущим строкам ввода:
 * средний float и суммарную стоимость, которую пользователь указал вручную или автоподбором.
 */
export const useAggregateCosts = (parsedRows: ParsedTradeupRow[]) => {
  const averageFloat = React.useMemo(() => {
    if (!parsedRows.length) return 0;
    const sum = parsedRows.reduce((acc, row) => acc + row.float, 0);
    return sum / parsedRows.length;
  }, [parsedRows]);

  const totalInputCost = React.useMemo(() => {
    return parsedRows.reduce((sum, row) => sum + (Number.isFinite(row.price) ? row.price : 0), 0);
  }, [parsedRows]);

  return { averageFloat, totalInputCost } as const;
};
