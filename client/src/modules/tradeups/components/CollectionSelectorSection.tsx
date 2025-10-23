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
  singleCovertCollectionTags: Set<string>;
}

export default function CollectionSelectorSection({
  steamCollections,
  loadSteamCollections,
  loadingSteamCollections,
  steamCollectionError,
  activeCollectionTag,
  selectCollection,
  selectedCollectionDetails,
  singleCovertCollectionTags,
}: CollectionSelectorSectionProps) {
  const [singleCovertOnly, setSingleCovertOnly] = React.useState(false);

  const collectionsToShow = React.useMemo(() => {
    if (!singleCovertOnly) return steamCollections;
    return steamCollections.filter((collection) =>
      singleCovertCollectionTags.has(collection.tag),
    );
  }, [singleCovertOnly, steamCollections, singleCovertCollectionTags]);

  const canFilterSingleCovert = singleCovertCollectionTags.size > 0;
  const showEmptyState = singleCovertOnly && collectionsToShow.length === 0;

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
        <div className="form-check form-switch text-nowrap small mb-0">
          <input
            className="form-check-input"
            type="checkbox"
            id="singleCovertOnly"
            checked={singleCovertOnly && canFilterSingleCovert}
            onChange={(event) => setSingleCovertOnly(event.target.checked)}
            disabled={!canFilterSingleCovert}
          />
          <label className="form-check-label" htmlFor="singleCovertOnly">
            Только 1 Covert
          </label>
        </div>
        {steamCollections.length === 0 && !loadingSteamCollections && (
          <span className="text-muted small">Нажмите кнопку, чтобы получить список коллекций.</span>
        )}
      </div>
      {steamCollectionError && <div className="text-danger mb-2">{steamCollectionError}</div>}
      {collectionsToShow.length > 0 && (
        <div className="tradeup-collections-list">
          {collectionsToShow.map((collection) => {
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
      {showEmptyState && (
        <div className="text-muted small">Нет коллекций с одним Covert скином.</div>
      )}
      {selectedCollectionDetails.length > 0 && (
        <div className="mt-3">
          <div className="fw-semibold">Диапазоны float целей</div>
          <div className="tradeup-hints">
            {selectedCollectionDetails.map((collection) => (
              <div key={collection.id} className="tradeup-hint card bg-secondary-subtle text-dark p-2">
                <div className="fw-semibold">{collection.name}</div>
                {collection.covert.length > 0 && (
                  <div className="mb-2">
                    <div className="small text-uppercase fw-semibold text-secondary">Covert</div>
                    <ul className="mb-0 small">
                      {collection.covert.map((skin) => (
                        <li key={`covert-${skin.baseName}`}>
                          {skin.baseName}: {skin.minFloat.toFixed(3)} – {skin.maxFloat.toFixed(3)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {collection.classified.length > 0 && (
                  <div>
                    <div className="small text-uppercase fw-semibold text-secondary">Classified</div>
                    <ul className="mb-0 small">
                      {collection.classified.map((skin) => (
                        <li key={`classified-${skin.baseName}`}>
                          {skin.baseName}: {skin.minFloat.toFixed(3)} – {skin.maxFloat.toFixed(3)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
