import React from "react";
import useTradeupBuilder from "./hooks/useTradeupBuilder";
import "./TradeupBuilder.css";

/**
 * Основной компонент-конструктор. Комбинирует хук useTradeupBuilder и отображает все шаги:
 * загрузку коллекций из Steam, выбор целевого скина, заполнение входов и показ результатов.
 */

/**
 * Приводит число к строке с фиксированным количеством знаков после запятой.
 * Используется для аккуратного отображения денежных значений и float-значений.
 */
const formatNumber = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";

/**
 * Преобразует вероятность в строку процента с двумя знаками после запятой.
 */
const formatPercent = (value: number) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";

const EXTERIOR_SHORT: Record<string, string> = {
  "Factory New": "FN",
  "Minimal Wear": "MW",
  "Field-Tested": "FT",
  "Well-Worn": "WW",
  "Battle-Scarred": "BS",
};

/** Сокращает название экстерьера до двухбуквенного обозначения. */
const shortExterior = (exterior: string) => EXTERIOR_SHORT[exterior] ?? exterior;

/** Порядок отображения экстерьеров от лучших к худшим. */
const WEAR_ORDER = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
] as const;

export default function TradeupBuilder() {
  const {
    steamCollections,
    collectionOptions,
    loadSteamCollections,
    loadingSteamCollections,
    steamCollectionError,
    activeCollectionTag,
    selectCollection,
    collectionTargets,
    loadingTargets,
    targetsError,
    selectedTarget,
    selectTarget,
    inputsLoading,
    inputsError,
    rows,
    updateRow,
    buyerFeePercent,
    setBuyerFeePercent,
    buyerToNetRate,
    averageFloat,
    totalBuyerCost,
    totalNetCost,
    selectedCollectionDetails,
    autofillPrices,
    priceLoading,
    calculate,
    calculation,
    calculating,
    calculationError,
    floatlessAnalysis,
  } = useTradeupBuilder();

  return (
    <div className="tradeup-builder card bg-dark text-white p-3 mb-4">
      <div className="d-flex flex-column flex-md-row justify-content-between gap-3">
        <div>
          <h2 className="h4">Trade-Up Constructor</h2>
          <p className="text-muted small mb-0">
            Подберите 10 входов, выберите целевые коллекции и рассчитайте ожидаемое значение.
          </p>
        </div>
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
              onChange={(event) => setBuyerFeePercent(Number(event.target.value) || 0)}
            />
            % (коэффициент {buyerToNetRate.toFixed(3)})
          </div>
        </div>
      </div>

      <hr className="border-secondary" />

      {/* Шаг 1: выбираем коллекцию и смотрим подсказки по float-диапазонам. */}
      <section>
        <h3 className="h5">1. Выбор коллекции</h3>
        <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
          <button
            type="button"
            className="btn btn-outline-light btn-sm"
            onClick={() => loadSteamCollections()}
            disabled={loadingSteamCollections}
          >
            {loadingSteamCollections ? "Загрузка…" : "Get all collections"}
          </button>
          {steamCollections.length === 0 && !loadingSteamCollections && (
            <span className="text-muted small">Нажмите кнопку, чтобы получить список коллекций.</span>
          )}
        </div>
        {steamCollectionError && <div className="text-danger mb-2">{steamCollectionError}</div>}
        {steamCollections.length > 0 && (
          <div className="tradeup-collections-list">
            {steamCollections.map((collection) => {
              const isActive = collection.tag === activeCollectionTag;
              const supported = Boolean(collection.collectionId);
              return (
                <button
                  type="button"
                  key={collection.tag}
                  className={`btn btn-sm ${isActive ? "btn-primary" : "btn-outline-light"}`}
                  onClick={() => selectCollection(collection.tag)}
                >
                  {collection.name}
                  {!supported && <span className="ms-2 badge text-bg-warning">нет float</span>}
                </button>
              );
            })}
          </div>
        )}
        {selectedCollectionDetails.length > 0 && (
          <div className="mt-3">
            <div className="fw-semibold">Диапазоны float целей</div>
            <div className="tradeup-hints">
              {selectedCollectionDetails.map((collection) => (
                <div key={collection!.id} className="tradeup-hint card bg-secondary-subtle text-dark p-2">
                  <div className="fw-semibold">{collection!.name}</div>
                  <ul className="mb-0 small">
                    {collection!.covert.map((skin) => (
                      <li key={skin.baseName}>
                        {skin.baseName}: {skin.minFloat.toFixed(3)} – {skin.maxFloat.toFixed(3)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <hr className="border-secondary" />

      {/* Шаг 2: выбираем конкретный Covert-результат и подтягиваем доступные входы. */}
      <section>
        <h3 className="h5">2. Целевой скин</h3>
        {!activeCollectionTag && (
          <div className="text-muted">Сначала выберите коллекцию.</div>
        )}
        {targetsError && <div className="text-danger">{targetsError}</div>}
        {loadingTargets && <div className="text-muted">Загрузка скинов…</div>}
        {activeCollectionTag && !loadingTargets && collectionTargets.length === 0 && !targetsError && (
          <div className="text-muted">Для этой коллекции не найдены Covert-скины.</div>
        )}
        {collectionTargets.length > 0 && (
          <div className="tradeup-targets">
            {collectionTargets.map((target) => (
              <div key={target.baseName} className="tradeup-target card bg-secondary-subtle text-dark p-2">
                <div className="fw-semibold">{target.baseName}</div>
                <div className="tradeup-target-exteriors d-flex flex-wrap gap-2 mt-2">
                  {target.exteriors.map((option) => {
                    const isSelected =
                      selectedTarget?.collectionTag === activeCollectionTag &&
                      selectedTarget?.marketHashName === option.marketHashName;
                    const floatHint =
                      option.minFloat != null && option.maxFloat != null
                        ? `${option.minFloat.toFixed(3)}-${option.maxFloat.toFixed(3)}`
                        : null;
                    return (
                      <button
                        type="button"
                        key={option.marketHashName}
                        className={`btn btn-sm ${isSelected ? "btn-primary" : "btn-outline-dark"}`}
                        onClick={() => {
                          if (activeCollectionTag) {
                            selectTarget(activeCollectionTag, target.baseName, option);
                          }
                        }}
                      >
                        {shortExterior(option.exterior)}
                        {floatHint && <span className="ms-1 small">({floatHint})</span>}
                        {option.price != null && (
                          <span className="ms-1 small text-muted">${formatNumber(option.price)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {inputsLoading && <div className="text-muted mt-2">Подбор входов…</div>}
        {inputsError && <div className="text-danger mt-2">{inputsError}</div>}
      </section>

      <hr className="border-secondary" />

      {/* Шаг 3: управляем входами и запускаем перерасчёт. */}
      <section>
        <h3 className="h5">3. Слот входа</h3>
        <div className="table-responsive">
          <table className="table table-dark table-sm align-middle tradeup-table">
            <thead>
              <tr>
                <th>#</th>
                <th>market_hash_name</th>
                <th>Коллекция</th>
                <th>Float</th>
                <th>Buyer $</th>
                <th>Net $ (после комиссии)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const buyerPrice = Number.parseFloat(row.buyerPrice);
                const netPrice = Number.isFinite(buyerPrice)
                  ? buyerPrice / buyerToNetRate
                  : NaN;
                return (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={row.marketHashName}
                        onChange={(event) => updateRow(index, { marketHashName: event.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={row.collectionId}
                        onChange={(event) => updateRow(index, { collectionId: event.target.value })}
                      >
                        <option value="">—</option>
                        {collectionOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                            {!option.supported ? " (нет float)" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max="1"
                        className="form-control form-control-sm"
                        value={row.float}
                        onChange={(event) => updateRow(index, { float: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="form-control form-control-sm"
                        value={row.buyerPrice}
                        onChange={(event) => updateRow(index, { buyerPrice: event.target.value })}
                      />
                    </td>
                    <td>{Number.isFinite(netPrice) ? `$${netPrice.toFixed(2)}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-outline-info btn-sm"
            onClick={() => autofillPrices()}
            disabled={priceLoading}
          >
            {priceLoading ? "Загрузка цен…" : "Подтянуть buyer-цены"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => calculate()}
            disabled={calculating}
          >
            {calculating ? "Расчёт…" : "Рассчитать ожидаемое значение (EV)"}
          </button>
        </div>
        {calculationError && <div className="text-danger mt-2">{calculationError}</div>}
      </section>

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
                    <strong
                      className={floatlessAnalysis.robustEV >= 0 ? "text-success" : "text-danger"}
                    >
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
                    <strong
                      className={floatlessAnalysis.expectedEV >= 0 ? "text-success" : "text-danger"}
                    >
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
                          {outcome.robustNet != null
                            ? `$${formatNumber(outcome.robustNet)}`
                            : "—"}
                        </td>
                        <td>
                          {expectedConditional != null
                            ? `$${formatNumber(expectedConditional)}`
                            : "—"}
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

      {/* Шаг 4: отображаем итоговую экономику и вероятности. */}
      {calculation && (
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
                    <td>{formatPercent(outcome.probability)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
