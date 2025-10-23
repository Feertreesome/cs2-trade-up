import React from "react";
import type { TradeupCalculationResponse } from "../services/api";
import type { TradeupAvailabilityState } from "../hooks/types";
import { formatNumber } from "../utils/format";

/**
 * Показывает подсказки по найденным объявлениям на рынке для выбранного исхода trade-up.
 */
interface AvailabilitySuggestionSectionProps {
  availabilityState: TradeupAvailabilityState;
  inputs: TradeupCalculationResponse["inputs"];
}

const formatFloat = (value: number | null | undefined, fallback = "—") => {
  if (value == null || Number.isNaN(value)) {
    return fallback;
  }
  return value.toFixed(5);
};

export default function AvailabilitySuggestionSection({
  availabilityState,
  inputs,
}: AvailabilitySuggestionSectionProps) {
  const { outcomeLabel, loading, error, result } = availabilityState;

  if (!outcomeLabel && !loading && !error && !result) {
    return null;
  }

  const differenceText =
    result?.targetAverageFloat != null && result?.assignedAverageFloat != null
      ? (result.assignedAverageFloat - result.targetAverageFloat).toFixed(5)
      : null;

  return (
    <section className="mt-4">
      <h4 className="h6 mb-2">
        Подбор входов{outcomeLabel ? ` • ${outcomeLabel}` : ""}
      </h4>
      {loading && <div className="text-info small mb-2">Поиск доступных предметов…</div>}
      {error && <div className="text-danger small mb-2">{error}</div>}
      {result && (
        <>
          <div className="text-muted small mb-2">
            Целевой средний float: {formatFloat(result.targetAverageFloat)}
            {result.assignedAverageFloat != null && (
              <>
                {" "}• Подобранный: {formatFloat(result.assignedAverageFloat)}
                {differenceText != null && <>{" "}(Δ {differenceText})</>}
              </>
            )}
          </div>
          <div className="table-responsive">
            <table className="table table-dark table-sm align-middle tradeup-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Запланированный market_hash_name</th>
                  <th>Подобранный listing</th>
                  <th>Float</th>
                  <th>Цена $</th>
                  <th>Inspect</th>
                </tr>
              </thead>
              <tbody>
                {inputs.map((input, index) => {
                  const slot = result.slots.find((entry) => entry.index === index);
                  const listing = slot?.listing ?? null;
                  const priceText =
                    listing?.price != null ? `$${formatNumber(listing.price)}` : "—";
                  let floatText = "—";
                  if (listing?.float != null) {
                    floatText = formatFloat(listing.float);
                  } else if (listing?.floatError) {
                    floatText = `Ошибка: ${listing.floatError}`;
                  }
                  return (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td>{input.marketHashName}</td>
                      <td>{listing?.marketHashName ?? "—"}</td>
                      <td>{floatText}</td>
                      <td>{priceText}</td>
                      <td>
                        {listing?.inspectLink ? (
                          <a
                            href={listing.inspectLink}
                            target="_blank"
                            rel="noreferrer"
                            className="link-info"
                          >
                            Inspect
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
          {result.missingSlots.length > 0 && (
            <div className="text-warning small mt-2">
              Не удалось подобрать предметы для слотов:{" "}
              {result.missingSlots.map((idx) => idx + 1).join(", ")}
            </div>
          )}
        </>
      )}
    </section>
  );
}
