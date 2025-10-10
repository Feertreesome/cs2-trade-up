import type {
  SteamCollectionSummary,
  TradeupCollection,
} from "../services/api";
import { Autocomplete, TextField, Chip } from "@mui/material";

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
          <span className="text-muted small">
            Нажмите кнопку, чтобы получить список коллекций.
          </span>
        )}
      </div>
      {steamCollectionError && (
        <div className="text-danger mb-2">{steamCollectionError}</div>
      )}
      {steamCollections.length > 0 && (
        <div className="tradeup-collections-list">
          <Autocomplete
            disablePortal
            options={steamCollections.map((collection) => collection)}
            getOptionLabel={(option) => option.name}
            sx={{ width: 300 }}
            onChange={(e, value) => {
              if (value) {
                selectCollection(value.tag);
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Collection"
                sx={{
                  "& .MuiInputBase-input": {
                    color: "#e2e3e5",
                  },
                  "& .MuiInputLabel-root": {
                    color: "#e2e3e5",
                  },
                }}
              />
            )}
            renderOption={(props, option) => {
              const supported = Boolean(option.collectionId);

              return (
                <li {...props}>
                  <span>{option.name}</span>
                  {!supported && (
                    <Chip
                      label="нет float"
                      color="warning"
                      size="small"
                      sx={{ ml: 1 }}
                    />
                  )}
                </li>
              );
            }}
          />
        </div>
      )}
      {selectedCollectionDetails.length > 0 && (
        <div className="mt-3">
          <div className="fw-semibold">Диапазоны float целей</div>
          <div className="tradeup-hints">
            {selectedCollectionDetails.map((collection) => (
              <div
                key={collection.id}
                className="tradeup-hint card bg-secondary-subtle text-dark p-2"
              >
                <div className="fw-semibold">{collection.name}</div>
                {collection.covert.length > 0 && (
                  <div className="mb-2">
                    <div className="small text-uppercase fw-semibold text-secondary">
                      Covert
                    </div>
                    <ul className="mb-0 small">
                      {collection.covert.map((skin) => (
                        <li key={`covert-${skin.baseName}`}>
                          {skin.baseName}: {skin.minFloat.toFixed(3)} –{" "}
                          {skin.maxFloat.toFixed(3)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {collection.classified.length > 0 && (
                  <div>
                    <div className="small text-uppercase fw-semibold text-secondary">
                      Classified
                    </div>
                    <ul className="mb-0 small">
                      {collection.classified.map((skin) => (
                        <li key={`classified-${skin.baseName}`}>
                          {skin.baseName}: {skin.minFloat.toFixed(3)} –{" "}
                          {skin.maxFloat.toFixed(3)}
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
