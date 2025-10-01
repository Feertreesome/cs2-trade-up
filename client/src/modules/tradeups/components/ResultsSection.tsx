import React from "react";
import type {
  TradeupCalculationResponse,
  TradeupOutcomeResponse,
  TradeupRealityCheckResponse,
} from "../services/api";
import { fetchOutcomeReality } from "../services/api";
import { formatNumber, formatPercent } from "../utils/format";

interface ResultsSectionProps {
  calculation: TradeupCalculationResponse;
  totalBuyerCost: number;
}

export default function ResultsSection({ calculation, totalBuyerCost }: ResultsSectionProps) {
  type RealityState = {
    loading: boolean;
    error?: string;
    data?: TradeupRealityCheckResponse;
  };

  const [expandedOutcomeKey, setExpandedOutcomeKey] = React.useState<string | null>(null);
  const [realityStates, setRealityStates] = React.useState<Record<string, RealityState>>({});

  const outcomeKey = React.useCallback(
    (outcome: TradeupOutcomeResponse) =>
      `${outcome.collectionId}-${outcome.marketHashName}-${outcome.exterior}`,
    [],
  );

  const loadReality = React.useCallback(
    (key: string, outcome: TradeupOutcomeResponse) => {
      setRealityStates((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? {}), loading: true, error: undefined },
      }));
      void fetchOutcomeReality(outcome.marketHashName, outcome.rollFloat)
        .then((data) => {
          setRealityStates((prev) => ({
            ...prev,
            [key]: { loading: false, data },
          }));
        })
        .catch((error) => {
          setRealityStates((prev) => ({
            ...prev,
            [key]: {
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        });
    },
    [],
  );

  const handleCheckClick = React.useCallback(
    (outcome: TradeupOutcomeResponse) => {
      const key = outcomeKey(outcome);
      setExpandedOutcomeKey((prev) => {
        const next = prev === key ? null : key;
        if (next === key) {
          const state = realityStates[key];
          if (!state?.data && !state?.loading) {
            loadReality(key, outcome);
          }
        }
        return next;
      });
    },
    [loadReality, outcomeKey, realityStates],
  );

  const handleRetry = React.useCallback(
    (outcome: TradeupOutcomeResponse) => {
      const key = outcomeKey(outcome);
      setExpandedOutcomeKey(key);
      loadReality(key, outcome);
    },
    [loadReality, outcomeKey],
  );

  const renderRealityDetails = (
    outcome: TradeupOutcomeResponse,
    state: RealityState | undefined,
  ) => {
    if (state?.loading) {
      return <div>Загружаем активные лоты...</div>;
    }
    if (state?.error) {
      return (
        <div className="text-danger">
          Не удалось получить данные: {state.error}
          <div className="mt-2">
            <button
              type="button"
              className="btn btn-sm btn-outline-danger"
              onClick={() => handleRetry(outcome)}
            >
              Попробовать снова
            </button>
          </div>
        </div>
      );
    }
    const data = state?.data;
    const listings = data?.listings ?? [];
    if (!listings.length) {
      return <div>На Steam сейчас нет активных предложений для этого скина.</div>;
    }
    const targetFloat = data?.rollFloat ?? outcome.rollFloat;
    const bestMatchId = data?.bestMatchListingId ?? null;

    return (
      <div>
        <div className="mb-2">
          Целевой float: <strong>{targetFloat.toFixed(6)}</strong>
        </div>
        <div className="table-responsive">
          <table className="table table-sm table-striped align-middle mb-0">
            <thead>
              <tr>
                <th style={{ width: "15%" }}>Цена (buyer)</th>
                <th style={{ width: "15%" }}>Float</th>
                <th style={{ width: "15%" }}>Δ от цели</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => {
                const isBest = listing.listingId === bestMatchId;
                return (
                  <tr key={listing.listingId} className={isBest ? "table-success" : undefined}>
                    <td className={isBest ? "fw-semibold" : undefined}>
                      {listing.price != null ? `$${formatNumber(listing.price)}` : "—"}
                    </td>
                    <td className={isBest ? "fw-semibold" : undefined}>
                      {listing.float != null ? listing.float.toFixed(6) : "—"}
                    </td>
                    <td className={isBest ? "fw-semibold" : undefined}>
                      {listing.difference != null ? listing.difference.toFixed(6) : "—"}
                    </td>
                    <td>
                      {listing.inspectUrl ? (
                        <a href={listing.inspectUrl} target="_blank" rel="noreferrer">
                          Inspect in game
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {bestMatchId && (
          <div className="mt-2 small text-muted">
            Ближайший к целевому float лот выделен зеленым цветом.
          </div>
        )}
      </div>
    );
  };

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
              <th className="text-center">Проверка</th>
            </tr>
          </thead>
          <tbody>
            {calculation.outcomes.map((outcome) => {
              const key = outcomeKey(outcome);
              const state = realityStates[key];
              const isExpanded = expandedOutcomeKey === key;
              return (
                <React.Fragment key={key}>
                  <tr>
                    <td>{`${outcome.baseName} (${outcome.exterior})`}</td>
                    <td>{outcome.collectionName}</td>
                    <td>{outcome.rollFloat.toFixed(5)}</td>
                    <td>{outcome.exterior}</td>
                    <td>{outcome.buyerPrice != null ? `$${formatNumber(outcome.buyerPrice)}` : "—"}</td>
                    <td>{outcome.netPrice != null ? `$${formatNumber(outcome.netPrice)}` : "—"}</td>
                    <td>
                      {outcome.netPrice != null
                        ? `$${formatNumber(outcome.netPrice - totalBuyerCost)}`
                        : "—"}
                    </td>
                    <td>{formatPercent(outcome.probability)}</td>
                    <td className="text-center">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-light"
                        onClick={() => handleCheckClick(outcome)}
                        disabled={state?.loading}
                      >
                        {state?.loading ? "Загрузка..." : "Проверить реальность"}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-dark-subtle text-dark">
                      <td colSpan={9}>
                        <div className="p-3">{renderRealityDetails(outcome, state)}</div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
