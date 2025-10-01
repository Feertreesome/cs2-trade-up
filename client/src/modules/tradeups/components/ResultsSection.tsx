import React from "react";
import type { RealPurchaseCheckResult } from "../hooks/useTradeupBuilder";
import type { TradeupCalculationResponse } from "../services/api";
import { formatNumber, formatPercent } from "../utils/format";

interface ResultsSectionProps {
  calculation: TradeupCalculationResponse;
  totalBuyerCost: number;
  onRunRealPurchaseCheck: () => void;
  realPurchaseCheckResult: RealPurchaseCheckResult | null;
  realPurchaseCheckLoading: boolean;
  realPurchaseCheckError: string | null;
}

export default function ResultsSection({
  calculation,
  totalBuyerCost,
  onRunRealPurchaseCheck,
  realPurchaseCheckResult,
  realPurchaseCheckLoading,
  realPurchaseCheckError,
}: ResultsSectionProps) {
  const topRealPurchaseItems = React.useMemo(() => {
    if (!realPurchaseCheckResult?.items?.length) return [];
    return realPurchaseCheckResult.items.slice(0, 10);
  }, [realPurchaseCheckResult]);

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

      <div className="d-flex flex-wrap align-items-center gap-2 mt-3">
        <button
          type="button"
          className="btn btn-outline-light btn-sm"
          onClick={() => onRunRealPurchaseCheck()}
          disabled={realPurchaseCheckLoading}
        >
          {realPurchaseCheckLoading ? "Проверка…" : "Проверка реальности покупки"}
        </button>
        {realPurchaseCheckLoading && <span className="small text-muted">Подбор входов…</span>}
      </div>
      {realPurchaseCheckError && <div className="text-danger mt-2">{realPurchaseCheckError}</div>}

      {realPurchaseCheckResult && topRealPurchaseItems.length > 0 && (
        <div className="card bg-secondary-subtle text-dark mt-3">
          <div className="card-body p-3">
            <div className="d-flex flex-wrap justify-content-between align-items-start gap-2">
              <div>
                <div className="fw-semibold">
                  Лучшие входы ({realPurchaseCheckResult.rarity})
                </div>
                {realPurchaseCheckResult.collectionName && (
                  <div className="small text-muted">{realPurchaseCheckResult.collectionName}</div>
                )}
              </div>
              <div className="small text-muted">
                Показаны топ {topRealPurchaseItems.length} по минимальному float
              </div>
            </div>
            <div className="table-responsive mt-2">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Предмет</th>
                    <th>Float диапазон</th>
                    <th>Buyer $</th>
                  </tr>
                </thead>
                <tbody>
                  {topRealPurchaseItems.map((item, index) => {
                    const floatRange =
                      item.minFloat != null && item.maxFloat != null
                        ? `${item.minFloat.toFixed(5)} — ${item.maxFloat.toFixed(5)}`
                        : item.minFloat != null
                        ? `${item.minFloat.toFixed(5)} — ?`
                        : "—";
                    return (
                      <tr key={item.marketHashName}>
                        <td>{index + 1}</td>
                        <td>{`${item.baseName} (${item.exterior})`}</td>
                        <td>{floatRange}</td>
                        <td>{item.price != null ? `$${formatNumber(item.price)}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {realPurchaseCheckResult && topRealPurchaseItems.length === 0 && !realPurchaseCheckError && (
        <div className="text-muted mt-2">Не удалось подобрать входы с известным float.</div>
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
