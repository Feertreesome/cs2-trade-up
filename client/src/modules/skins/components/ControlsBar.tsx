import React from "react";
import type { ExpandMode, Rarity } from "../services";

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
  onLoadProgressive: () => void;
  onFetchNames: () => void;
  loading: boolean;
};

const ControlsBar: React.FC<ControlsBarProps> = (props) => {
  return (
    <div className="controls-grid">
      <div>
        <div className="label">Rarity</div>
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
        <div className="label">Aggregate</div>
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
        <div className="label">Normal only</div>
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
        <div className="label">Expand exteriors</div>
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

      <div style={{ alignSelf: "end" }}>
        <button className="btn" onClick={props.onLoadProgressive} disabled={props.loading}>Load progressively</button>
        <button className="btn" style={{ marginLeft: 8 }} onClick={props.onFetchNames} disabled={props.loading}>Get names</button>
      </div>
    </div>
  );
};

export default ControlsBar;
