import React from "react";
import type { FloatlessAnalysisResult } from "../hooks/useTradeupBuilder";
import { formatNumber, formatPercent } from "../utils/format";
import { shortExterior, WEAR_ORDER } from "../utils/wear";

interface FloatlessAnalysisSectionProps {
  floatlessAnalysis: FloatlessAnalysisResult;
}

export default function FloatlessAnalysisSection({
  floatlessAnalysis,
}: FloatlessAnalysisSectionProps) {
  return (
    <section className="mt-4">
      <h3 className="h5">3a. Оценка без float (robust / expected)</h3>
      {floatlessAnalysis.issues.length > 0 && (
        <div className="alert alert-warning mb-3">
          <div className="fw-semibold">Нужно поправить входы:</div>
          <ul className="mb-0">
            {floatlessAnalysis.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {floatlessAnalysis.ready && floatlessAnalysis.inputRange && (
        <>
          <div className="card bg-secondary-subtle text-dark p-3 mb-3">
            <div>
              Диапазон среднего float:{" "}
              <strong>
                {floatlessAnalysis.inputRange.min.toFixed(3)} – {floatlessAnalysis.inputRange.max.toFixed(3)}
              </strong>
            </div>
            <div>
              Рецепт:{" "}
              {WEAR_ORDER.filter((exterior) => floatlessAnalysis.wearCounts[exterior])
                .map((exterior) => `${shortExterior(exterior)}×${floatlessAnalysis.wearCounts[exterior]}`)
                .join(", ") || "—"}
            </div>
            <div>
              Робастная чистая прибыль (минимум):{" "}
              <strong>
                {floatlessAnalysis.robustOutcomeNet != null
                  ? `$${formatNumber(floatlessAnalysis.robustOutcomeNet)}`
                  : "—"}
              </strong>
              {floatlessAnalysis.robustEV != null && (
                <span className="ms-2">
                  Ожидаемое значение (EV):{" "}
                  <strong className={floatlessAnalysis.robustEV >= 0 ? "text-success" : "text-danger"}>
                    ${formatNumber(floatlessAnalysis.robustEV)}
                  </strong>
                </span>
              )}
            </div>
            <div>
              Ожидаемая чистая прибыль:{" "}
              <strong>
                {floatlessAnalysis.expectedOutcomeNet != null
                  ? `$${formatNumber(floatlessAnalysis.expectedOutcomeNet)}`
                  : "—"}
              </strong>
              {floatlessAnalysis.expectedEV != null && (
                <span className="ms-2">
                  Ожидаемое значение (EV):{" "}
                  <strong className={floatlessAnalysis.expectedEV >= 0 ? "text-success" : "text-danger"}>
                    ${formatNumber(floatlessAnalysis.expectedEV)}
                  </strong>
                </span>
              )}
              <span className="ms-2 text-muted">
                покрытие цен: {formatPercent(floatlessAnalysis.expectedCoverage)}
              </span>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-dark table-sm align-middle">
              <thead>
                <tr>
                  <th>Covert</th>
                  <th>Вероятность</th>
                  <th>Проекция float</th>
                  <th>Возможные wear</th>
                  <th>Робастная чистая прибыль</th>
                  <th>Ожидаемая чистая прибыль</th>
                  <th>Покрытие</th>
                </tr>
              </thead>
              <tbody>
                {floatlessAnalysis.outcomes.map((outcome) => {
                  const expectedConditional =
                    outcome.expectedNetContribution != null && outcome.expectedProbabilityCovered > 0
                      ? outcome.expectedNetContribution / outcome.expectedProbabilityCovered
                      : null;
                  return (
                    <tr key={outcome.baseName}>
                      <td>{outcome.baseName}</td>
                      <td>{formatPercent(outcome.probability)}</td>
                      <td>
                        {outcome.projectedRange.min.toFixed(3)} – {outcome.projectedRange.max.toFixed(3)}
                      </td>
                      <td>
                        <ul className="mb-0 small">
                          {outcome.exteriors.map((option) => (
                            <li key={option.marketHashName}>
                              {shortExterior(option.exterior)}:{" "}
                              {option.probability != null ? formatPercent(option.probability) : "—"}
                              {", net "}
                              {option.netPrice != null ? `$${formatNumber(option.netPrice)}` : "—"}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        {outcome.robustNet != null ? `$${formatNumber(outcome.robustNet)}` : "—"}
                      </td>
                      <td>
                        {expectedConditional != null ? `$${formatNumber(expectedConditional)}` : "—"}
                      </td>
                      <td>{formatPercent(outcome.expectedProbabilityCovered)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
