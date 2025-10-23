import React from "react";
import type {
  CollectionTargetExterior,
  CollectionTargetSummary,
  TargetRarity,
} from "../services/api";
import type { SelectedTarget } from "../hooks/useTradeupBuilder";
import { formatNumber } from "../utils/format";
import { shortExterior } from "../utils/wear";

interface TargetSelectionSectionProps {
  activeCollectionTag: string | null;
  targetRarity: TargetRarity;
  setTargetRarity: (rarity: TargetRarity) => void;
  collectionTargets: CollectionTargetSummary[];
  loadingTargets: boolean;
  targetsError: string | null;
  selectedTarget: SelectedTarget | null;
  selectTarget: (
    collectionTag: string,
    baseName: string,
    option: CollectionTargetExterior,
  ) => void;
  inputsLoading: boolean;
  inputsError: string | null;
}

export default function TargetSelectionSection({
  activeCollectionTag,
  targetRarity,
  setTargetRarity,
  collectionTargets,
  loadingTargets,
  targetsError,
  selectedTarget,
  selectTarget,
  inputsLoading,
  inputsError,
}: TargetSelectionSectionProps) {
  const rarityOptions: Array<{ value: TargetRarity; label: string }> = React.useMemo(
    () => [
      { value: "Covert", label: "Covert" },
      { value: "Classified", label: "Classified" },
      { value: "Restricted", label: "Restricted" },
      { value: "Mil-Spec", label: "Mil-Spec" },
      { value: "Industrial", label: "Industrial" },
      { value: "Consumer", label: "Consumer" },
    ],
    [],
  );

  const rarityLabel = React.useMemo(() => {
    return rarityOptions.find((option) => option.value === targetRarity)?.label ?? targetRarity;
  }, [rarityOptions, targetRarity]);

  return (
    <section>
      <h3 className="h5">2. Целевой скин</h3>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <span className="text-muted small">Качество результата:</span>
        <div className="btn-group btn-group-sm flex-wrap" role="group">
          {rarityOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`btn ${targetRarity === option.value ? "btn-primary" : "btn-outline-light"}`}
              onClick={() => setTargetRarity(option.value)}
              disabled={loadingTargets}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {!activeCollectionTag && <div className="text-muted">Сначала выберите коллекцию.</div>}
      {targetsError && <div className="text-danger">{targetsError}</div>}
      {loadingTargets && <div className="text-muted">Загрузка скинов…</div>}
      {activeCollectionTag && !loadingTargets && collectionTargets.length === 0 && !targetsError && (
        <div className="text-muted">Для этой коллекции не найдены {rarityLabel}-скины.</div>
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
  );
}
