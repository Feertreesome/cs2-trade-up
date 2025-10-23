import React from "react";
import { batchPriceOverview } from "../../services/api";
import type { TradeupInputFormRow } from "../types";

/**
 * Автоматически подтягивает цены из Steam для указанного списка market_hash_name
 * и обновляет строки ввода. Ошибки прокидываются наружу через reportError.
 */
interface PriceAutofillOptions {
  rows: TradeupInputFormRow[];
  setRows: React.Dispatch<React.SetStateAction<TradeupInputFormRow[]>>;
  reportError: (message: string | null) => void;
}

export const usePriceAutofill = ({
  rows,
  setRows,
  reportError,
}: PriceAutofillOptions) => {
  const [priceLoading, setPriceLoading] = React.useState(false);

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
              return { ...row, price: price.toFixed(2) };
            }
            return row;
          }),
        );
      } catch (error: any) {
        reportError(String(error?.message || error));
      } finally {
        setPriceLoading(false);
      }
    },
    [reportError, rows, setRows],
  );

  return { priceLoading, autofillPrices };
};
