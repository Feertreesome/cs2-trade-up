import React from "react";
import useTradeupBuilder from "./hooks/useTradeupBuilder";
import "./TradeupBuilder.css";

const formatNumber = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";

const formatPercent = (value: number) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";

export default function TradeupBuilder() {
  const {
    collections,
    loadingCollections,
    collectionError,
    selectedCollections,
    toggleCollection,
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

      <section>
        <h3 className="h5">1. Выбор коллекций</h3>
        {loadingCollections && <div className="text-muted">Загрузка коллекций…</div>}
        {collectionError && <div className="text-danger">{collectionError}</div>}
        {!loadingCollections && !collectionError && (
          <div className="tradeup-collections">
            {collections.map((collection) => (
              <label key={collection.id} className="form-check-label">
                <input
                  type="checkbox"
                  className="form-check-input me-2"
                  checked={selectedCollections.includes(collection.id)}
                  onChange={() => toggleCollection(collection.id)}
                />
                {collection.name}
              </label>
            ))}
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

      <section>
        <h3 className="h5">2. Слот входа</h3>
        <div className="table-responsive">
          <table className="table table-dark table-sm align-middle tradeup-table">
            <thead>
              <tr>
                <th>#</th>
                <th>market_hash_name</th>
                <th>Коллекция</th>
                <th>Float</th>
                <th>Buyer $</th>
                <th>Net $</th>
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
                        {collections.map((collection) => (
                          <option key={collection.id} value={collection.id}>
                            {collection.name}
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
            {calculating ? "Расчёт…" : "Рассчитать EV"}
          </button>
        </div>
        {calculationError && <div className="text-danger mt-2">{calculationError}</div>}
      </section>

      {calculation && (
        <section className="mt-4">
          <h3 className="h5">3. Результаты</h3>
          <div className="tradeup-results card bg-secondary-subtle text-dark p-3">
            <div>Ожидаемый возврат (net): <strong>${formatNumber(calculation.totalOutcomeNet)}</strong></div>
            <div>
              EV:{" "}
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
                  <th>Net $</th>
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
