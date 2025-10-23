import React from "react";
import type { TradeupCalculationResponse } from "../services/api";
import type { TradeupAvailabilityState } from "../hooks/types";
import AvailabilitySuggestionSection from "./AvailabilitySuggestionSection";
import { formatNumber, formatPercent } from "../utils/format";

/**
 * Отображает результаты расчёта trade-up: ожидаемую стоимость, распределение исходов
 * и позволяет запустить проверку наличия предметов на рынке.
 */
interface ResultsSectionProps {
  calculation: TradeupCalculationResponse;
  totalInputCost: number;
  availabilityState: TradeupAvailabilityState;
  onCheckAvailability: (
    outcome: TradeupCalculationResponse["outcomes"][number],
  ) => void | Promise<void>;
}

export default function ResultsSection({
  calculation,
  totalInputCost,
  availabilityState,
  onCheckAvailability,
}: ResultsSectionProps) {
  return (
    <section className="mt-4">
      <h3 className="h5">4. Результаты</h3>
      <div className="tradeup-results card bg-secondary-subtle text-dark p-3">
        <div>
          Ожидаемый возврат: <strong>${formatNumber(calculation.totalOutcomeNet)}</strong>
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
              <th>Цена $</th>
              <th>Прибыль</th>
              <th>Вероятность</th>
              <th>Доступность</th>
            </tr>
          </thead>
          <tbody>
            {calculation.outcomes.map((outcome) => {
              const outcomeKey = `${outcome.collectionId}:${outcome.marketHashName}`;
              const isChecking =
                availabilityState.loading && availabilityState.activeOutcomeKey === outcomeKey;
              return (
                <tr key={`${outcome.collectionId}-${outcome.baseName}`}>
                  <td>{`${outcome.baseName} (${outcome.exterior})`}</td>
                <td>{outcome.collectionName}</td>
                <td>{outcome.rollFloat.toFixed(5)}</td>
                <td>{outcome.exterior}</td>
                <td>{outcome.netPrice != null ? `$${formatNumber(outcome.netPrice)}` : "—"}</td>
                <td>{outcome.netPrice != null ? `$${formatNumber(outcome.netPrice - totalInputCost)}` : "—"}</td>
                <td>{formatPercent(outcome.probability)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-outline-info btn-sm"
                      onClick={() => onCheckAvailability(outcome)}
                      disabled={isChecking}
                    >
                      {isChecking ? "Проверяем…" : "Проверить наличие"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <AvailabilitySuggestionSection
        availabilityState={availabilityState}
        inputs={calculation.inputs}
      />
    </section>
  );
}
