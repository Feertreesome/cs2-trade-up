import React from "react";
import type { ExpandMode, Rarity } from "../services";

const Help: React.FC<{ text: string }> = ({ text }) => (
  <span className="help" title={text}>?</span>
);

/**
 * Панель управляет параметрами загрузки скинов.
 * Обратите внимание: options принимают ReadonlyArray — можно передавать константы с `as const`.
 */
type ControlsBarProps = {
  rarity: Rarity;
  setRarity: (next: Rarity) => void;
  rarityOptions: ReadonlyArray<Rarity>;               // ← было: Rarity[]
  aggregate: boolean;
  setAggregate: (next: boolean) => void;

  normalOnly: boolean;
  setNormalOnly: (next: boolean) => void;

  expandExteriors: ExpandMode;
  setExpandExteriors: (next: ExpandMode) => void;
  expandOptions: ReadonlyArray<ExpandMode>;           // ← было: ExpandMode[]
  actualPrices: boolean;
  setActualPrices: (next: boolean) => void;
  actualListings: boolean;
  setActualListings: (next: boolean) => void;
  onLoadProgressive: () => void;
  onFetchNames: () => void;
  onShowOldList: () => void;
  onAddCorrectPrice: () => void;
  onFixZeroPrice: () => void;
  onAddCorrectListings: () => void;
  onFixZeroListings: () => void;
  oldListDate: string | null;
  loading: boolean;
};

const ControlsBar: React.FC<ControlsBarProps> = (props) => {
  return (
    <div className="controls-grid">
      <div>
        <div className="label">
          Rarity <Help text="Choose rarity to fetch" />
        </div>
        <select
          className="input"
          value={props.rarity}
          onChange={(e) => props.setRarity(e.target.value as Rarity)}
        >
          {props.rarityOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="label">
          Aggregate <Help text="Group by base name" />
        </div>
        <select
          className="input"
          value={props.aggregate ? "1" : "0"}
          onChange={(e) => props.setAggregate(e.target.value === "1")}
        >
          <option value="1">Yes</option>
          <option value="0">No (flat)</option>
        </select>
      </div>

      <div>
        <div className="label">
          Normal only <Help text="Exclude StatTrak and Souvenir" />
        </div>
        <select
          className="input"
          value={props.normalOnly ? "1" : "0"}
          onChange={(e) => props.setNormalOnly(e.target.value === "1")}
        >
          <option value="1">Yes (no ST/Souv)</option>
          <option value="0">No</option>
        </select>
      </div>

      <div>
        <div className="label">
          Expand exteriors <Help text="Add missing exterior variants" />
        </div>
        <select
          className="input"
          value={props.expandExteriors}
          onChange={(e) => props.setExpandExteriors(e.target.value as ExpandMode)}
        >
          {props.expandOptions.map((mode) => (
            <option key={mode} value={mode}>{mode}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="label">
          Actual prices <Help text="Fetch live prices on load" />
        </div>
        <input
          type="checkbox"
          checked={props.actualPrices}
          onChange={(e) => props.setActualPrices(e.target.checked)}
        />
      </div>

      <div>
        <div className="label">
          Actual listings <Help text="Fetch live listing counts" />
        </div>
        <input
          type="checkbox"
          checked={props.actualListings}
          onChange={(e) => props.setActualListings(e.target.checked)}
        />
      </div>

      <div className="buttons" style={{ alignSelf: "end" }}>
        <div className="btn-wrap">
          <button className="btn" onClick={props.onLoadProgressive} disabled={props.loading}>Load progressively</button>
          <Help text="Load items page by page" />
        </div>
        <div className="btn-wrap">
          <button className="btn" onClick={props.onFetchNames} disabled={props.loading}>Get names</button>
          <Help text="Store market hash names" />
        </div>
        <div className="btn-wrap">
          <button
            className="btn"
            onClick={props.onShowOldList}
            disabled={!props.oldListDate || props.loading}
          >
            Show old list
          </button>
          <Help text="Load list from local storage" />
          {props.oldListDate && (
            <div className="small" style={{ marginTop: 4 }}>
              {new Date(props.oldListDate).toLocaleString()}
            </div>
          )}
        </div>
        <div className="btn-wrap">
          <button className="btn" onClick={props.onAddCorrectPrice} disabled={props.loading}>Add correct price</button>
          <Help text="Refresh prices for all items" />
        </div>
        <div className="btn-wrap">
          <button className="btn" onClick={props.onFixZeroPrice} disabled={props.loading}>Fix zero price</button>
          <Help text="Update items with missing price" />
        </div>
        <div className="btn-wrap">
          <button className="btn" onClick={props.onAddCorrectListings} disabled={props.loading}>Add correct listings</button>
          <Help text="Refresh listing totals for all items" />
        </div>
        <div className="btn-wrap">
          <button className="btn" onClick={props.onFixZeroListings} disabled={props.loading}>Fix zero listings</button>
          <Help text="Update items with missing listings" />
        </div>
      </div>
    </div>
  );
};

export default ControlsBar;
