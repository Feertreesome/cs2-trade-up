import React from "react";
import { formatNumber } from "../utils/format";

interface TradeupSummaryProps {
  averageFloat: number;
  totalBuyerCost: number;
  totalNetCost: number;
  buyerFeePercent: number;
  buyerToNetRate: number;
  onBuyerFeeChange: (value: number) => void;
}

export default function TradeupSummary({
  averageFloat,
  totalBuyerCost,
  totalNetCost,
  buyerFeePercent,
  buyerToNetRate,
  onBuyerFeeChange,
}: TradeupSummaryProps) {
  return (
    <div className="tradeup-summary card bg-secondary-subtle text-dark p-3">
      <div className="fw-semibold">Текущий ввод</div>
      <div>Средний float: <strong>{formatNumber(averageFloat, 5)}</strong></div>
      <div>Суммарно (buyer): <strong>${formatNumber(totalBuyerCost)}</strong></div>
      <div>Суммарно (net): <strong>${formatNumber(totalNetCost)}</strong></div>
      <div>
        Комиссия:{" "}
        <input
          type="number"
          min={0}
          step={0.1}
          className="form-control form-control-sm d-inline-block w-auto ms-2"
          value={buyerFeePercent}
          onChange={(event) => onBuyerFeeChange(Number(event.target.value) || 0)}
        />
        % (коэффициент {buyerToNetRate.toFixed(3)})
      </div>
    </div>
  );
}
