import React from "react";
import type { TradeupCalculationResponse } from "../services/api";
import { formatNumber, formatPercent } from "../utils/format";

interface ResultsSectionProps {
  calculation: TradeupCalculationResponse;
  totalBuyerCost: number;
}

export default function ResultsSection({ calculation, totalBuyerCost }: ResultsSectionProps) {
  return (
    <section className="mt-4">
      <h3 className="h5">4. Результаты</h3>
      <div className="tradeup-results card bg-secondary-subtle text-dark p-3">
        <div>
          Ожидаемый возврат после комиссии (net): <strong>${formatNumber(calculation.totalOutcomeNet)}</strong>
        </div>
        <div>
          Ожидаемое значение (EV):{" "}
          <strong className={calculation.expectedValue >= 0 ? "text-success" : "text-danger"}>
            ${formatNumber(calculation.expectedValue)}
          </strong>
        </div>
        <div>Допустимый бюджет на слот: <strong>${formatNumber(calculation.maxBudgetPerSlot)}</strong></div>
        <div>Шанс плюса: <strong>{formatPercent(calculation.positiveOutcomeProbability)}</strong></div>
      </div>

      {calculation.warnings.length > 0 && (
        <div className="alert alert-warning mt-3 mb-0">
          <div className="fw-semibold">Предупреждения</div>
          <ul className="mb-0">
            {calculation.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="table-responsive mt-3">
        <table className="table table-dark table-sm align-middle">
          <thead>
            <tr>
              <th>Результат</th>
              <th>Коллекция</th>
              <th>Float</th>
              <th>Wear</th>
              <th>Buyer $</th>
              <th>Net $ (после комиссии)</th>
              <th>Прибыль</th>
              <th>Вероятность</th>
            </tr>
          </thead>
          <tbody>
            {calculation.outcomes.map((outcome) => (
              <tr key={`${outcome.collectionId}-${outcome.baseName}`}>
                <td>{`${outcome.baseName} (${outcome.exterior})`}</td>
                <td>{outcome.collectionName}</td>
                <td>{outcome.rollFloat.toFixed(5)}</td>
                <td>{outcome.exterior}</td>
                <td>{outcome.buyerPrice != null ? `$${formatNumber(outcome.buyerPrice)}` : "—"}</td>
                <td>{outcome.netPrice != null ? `$${formatNumber(outcome.netPrice)}` : "—"}</td>
                <td>{outcome.netPrice != null ? `$${formatNumber(outcome.netPrice - totalBuyerCost)}` : "—"}</td>
                <td>{formatPercent(outcome.probability)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
