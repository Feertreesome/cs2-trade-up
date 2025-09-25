import React from "react";
import type { CollectionSelectOption, TradeupInputFormRow } from "../hooks/useTradeupBuilder";

interface InputsTableSectionProps {
  rows: TradeupInputFormRow[];
  collectionOptions: CollectionSelectOption[];
  buyerToNetRate: number;
  updateRow: (index: number, patch: Partial<TradeupInputFormRow>) => void;
  autofillPrices: () => void | Promise<void>;
  priceLoading: boolean;
  calculate: () => void | Promise<void>;
  calculating: boolean;
  calculationError: string | null;
}

export default function InputsTableSection({
  rows,
  collectionOptions,
  buyerToNetRate,
  updateRow,
  autofillPrices,
  priceLoading,
  calculate,
  calculating,
  calculationError,
}: InputsTableSectionProps) {
  return (
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
              const netPrice = Number.isFinite(buyerPrice) ? buyerPrice / buyerToNetRate : NaN;
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
  );
}
