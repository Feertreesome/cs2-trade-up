import React from "react";
import type { SteamCollectionSummary, TradeupCollection } from "../services/api";

interface CollectionSelectorSectionProps {
  steamCollections: SteamCollectionSummary[];
  loadSteamCollections: () => void | Promise<void>;
  loadingSteamCollections: boolean;
  steamCollectionError: string | null;
  activeCollectionTag: string | null;
  selectCollection: (tag: string) => void;
  selectedCollectionDetails: TradeupCollection[];
}

export default function CollectionSelectorSection({
  steamCollections,
  loadSteamCollections,
  loadingSteamCollections,
  steamCollectionError,
  activeCollectionTag,
  selectCollection,
  selectedCollectionDetails,
}: CollectionSelectorSectionProps) {
  return (
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
              <div key={collection.id} className="tradeup-hint card bg-secondary-subtle text-dark p-2">
                <div className="fw-semibold">{collection.name}</div>
                <ul className="mb-0 small">
                  {collection.covert.map((skin) => (
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
  );
}
