import React from "react";
import { formatNumber } from "../utils/format";

/**
 * Показывает краткую сводку по текущим входам: средний float и суммарную стоимость.
 */
interface TradeupSummaryProps {
  averageFloat: number;
  totalInputCost: number;
}

export default function TradeupSummary({
  averageFloat,
  totalInputCost,
}: TradeupSummaryProps) {
  return (
    <div className="tradeup-summary card bg-secondary-subtle text-dark p-3">
      <div className="fw-semibold">Текущий ввод</div>
      <div>Средний float: <strong>{formatNumber(averageFloat, 5)}</strong></div>
      <div>Суммарная стоимость: <strong>${formatNumber(totalInputCost)}</strong></div>
    </div>
  );
}
