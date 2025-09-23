import React from "react";
import {
  EXTERIORS,
  batchListingTotals,
  batchPriceOverview,
  fetchSkinsSchema,
  getAvailableExteriors,
  getCaseSkinsByRarity,
  getCollectionForSkin,
  LOWER_RARITY_MAP,
  type AggGroup,
  type Exterior,
  type Rarity,
  type SkinsSchema,
} from "../services";

type SkinSummary = {
  marketHashName: string;
  baseName: string;
  rarity: Rarity;
  exterior: Exterior;
  price: number | null | undefined;
  sellListings: number;
};

type Props = {
  selected: SkinSummary;
  group: AggGroup | null;
  onClose: () => void;
};

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toFixed(2)}`;

const normalizeGroup = (
  selected: SkinSummary,
  group: AggGroup | null,
): AggGroup => {
  if (group) return group;
  return {
    baseName: selected.baseName,
    rarity: selected.rarity,
    exteriors: [
      {
        exterior: selected.exterior,
        marketHashName: selected.marketHashName,
        sell_listings: selected.sellListings,
        price: selected.price ?? null,
      },
    ],
  };
};

const orderByExterior = (
  exteriors: AggGroup["exteriors"],
) =>
  exteriors
    .slice()
    .sort(
      (a, b) =>
        EXTERIORS.indexOf(a.exterior) - EXTERIORS.indexOf(b.exterior),
    );

const extractNames = (baseName: string) => {
  const [weaponRaw, ...rest] = baseName.split("|");
  const weapon = weaponRaw?.trim() ?? baseName;
  const skin = rest.join("|").trim();
  return {
    weapon,
    skin: skin || baseName,
  };
};

type LowerRarityRow = {
  baseName: string;
  exterior: Exterior;
  marketHashName: string;
  price: number | null;
  sellListings: number | null;
};

const useSchemaData = () => {
  const [schema, setSchema] = React.useState<SkinsSchema | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setError(null);

    fetchSkinsSchema()
      .then((data) => {
        if (!cancelled) setSchema(data);
      })
      .catch((e: any) => {
        if (!cancelled) setError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { schema, loading, error } as const;
};

const useLowerRaritySkins = (
  schema: SkinsSchema | null,
  collection: string | null,
  rarity: Rarity,
) => {
  const [rows, setRows] = React.useState<LowerRarityRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const lowerRarity = LOWER_RARITY_MAP[rarity];

  React.useEffect(() => {
    let cancelled = false;

    if (!schema || !collection || !lowerRarity) {
      setRows([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    const baseNames = getCaseSkinsByRarity(schema, collection, lowerRarity)
      .slice()
      .sort((a, b) => a.localeCompare(b));

    if (!baseNames.length) {
      setRows([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    const combos = baseNames.flatMap((name) => {
      const exteriors = getAvailableExteriors(schema, collection, name);
      return exteriors.map<LowerRarityRow>((exterior) => ({
        baseName: name,
        exterior,
        marketHashName: `${name} (${exterior})`,
        price: null,
        sellListings: null,
      }));
    });

    if (!combos.length) {
      setRows([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    const uniqueNames = Array.from(
      new Set(combos.map((combo) => combo.marketHashName)),
    );

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [priceMap, listingMap] = await Promise.all([
          uniqueNames.length
            ? batchPriceOverview(uniqueNames)
            : Promise.resolve<Record<string, number | null>>({}),
          uniqueNames.length
            ? batchListingTotals(uniqueNames)
            : Promise.resolve<Record<string, number | null>>({}),
        ]);
        if (cancelled) return;
        const nextRows = combos.map((combo) => ({
          ...combo,
          price: priceMap?.[combo.marketHashName] ?? null,
          sellListings: listingMap?.[combo.marketHashName] ?? null,
        }));
        setRows(nextRows);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [schema, collection, lowerRarity]);

  return { lowerRarity, rows, loading, error } as const;
};

const useActualPrice = (selected: SkinSummary) => {
  const [price, setPrice] = React.useState<number | null | undefined>(
    selected.price,
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setPrice(selected.price);
    setError(null);
    setLoading(true);

    const load = async () => {
      try {
        const map = await batchPriceOverview([selected.marketHashName]);
        if (cancelled) return;
        const fetched = map[selected.marketHashName];
        setPrice(fetched ?? null);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [selected.marketHashName, selected.price]);

  return { price, loading, error } as const;
};

const useModalLifecycle = (onClose: () => void) => {
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);
};

const SkinModal: React.FC<Props> = ({ selected, group, onClose }) => {
  useModalLifecycle(onClose);

  const resolvedGroup = React.useMemo(
    () => normalizeGroup(selected, group),
    [selected, group],
  );
  const allExteriors = React.useMemo(
    () => orderByExterior(resolvedGroup.exteriors),
    [resolvedGroup],
  );
  const { weapon, skin } = React.useMemo(
    () => extractNames(selected.baseName),
    [selected.baseName],
  );
  const { price, loading, error } = useActualPrice(selected);
  const {
    schema,
    loading: schemaLoading,
    error: schemaError,
  } = useSchemaData();

  const collection = React.useMemo(
    () => (schema ? getCollectionForSkin(schema, selected.baseName) : null),
    [schema, selected.baseName],
  );

  const sameRaritySkins = React.useMemo(() => {
    if (!schema || !collection) return [];
    return getCaseSkinsByRarity(schema, collection, selected.rarity)
      .slice()
      .sort((a, b) => a.localeCompare(b));
  }, [schema, collection, selected.rarity]);

  const {
    lowerRarity,
    rows: lowerRows,
    loading: lowerLoading,
    error: lowerError,
  } = useLowerRaritySkins(schema, collection, selected.rarity);

  return (
    <div
      className="sbc-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="sbc-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sbc-modal-header">
          <div>
            <div className="sbc-modal-title">{skin}</div>
            <div className="small">
              {weapon}
              {" • "}
              {selected.rarity}
            </div>
          </div>
          <button
            type="button"
            className="sbc-modal-close"
            aria-label="Закрыть"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="sbc-modal-grid">
          <div className="sbc-modal-card sbc-modal-card--info">
            <h4>Информация</h4>
            <div className="sbc-modal-info">
              <div>
                <div className="label">Коллекция</div>
                <div>
                  {schemaLoading
                    ? "Загрузка…"
                    : collection ?? "Неизвестно"}
                </div>
              </div>
              <div>
                <div className="label">Оружие</div>
                <div>{weapon}</div>
              </div>
              <div>
                <div className="label">Market hash name</div>
                <div>{selected.marketHashName}</div>
              </div>
              <div>
                <div className="label">Качество</div>
                <div>{selected.exterior}</div>
              </div>
              <div>
                <div className="label">Листов на продаже</div>
                <div>{selected.sellListings}</div>
              </div>
              <div>
                <div className="label">Актуальная цена</div>
                <div
                  className={`sbc-modal-price${loading ? " loading" : ""}`}
                >
                  {loading ? "Загрузка…" : fmt(price)}
                </div>
              </div>
              {error && <div className="sbc-modal-error">{error}</div>}
              {schemaError && (
                <div className="sbc-modal-error">{schemaError}</div>
              )}
            </div>
          </div>

          <div className="sbc-modal-card sbc-modal-card--list">
            <h4>Скины этой редкости</h4>
            {schemaLoading ? (
              <div className="sbc-modal-muted">Загрузка…</div>
            ) : !collection ? (
              <div className="sbc-modal-muted">
                Коллекция не найдена для этого предмета.
              </div>
            ) : sameRaritySkins.length ? (
              <ul className="sbc-modal-list">
                {sameRaritySkins.map((name) => (
                  <li
                    key={name}
                    className={
                      name === selected.baseName ? "active" : undefined
                    }
                  >
                    {name}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="sbc-modal-muted">
                Нет данных о предметах этой редкости в коллекции.
              </div>
            )}
          </div>
        </div>

        <div className="sbc-modal-card sbc-modal-card--full">
          <h4>Все состояния</h4>
          <table className="sbc-modal-table">
            <thead>
              <tr>
                <th className="text-start">Состояние</th>
                <th>Листов</th>
                <th>Цена</th>
              </tr>
            </thead>
            <tbody>
              {allExteriors.map((ext) => (
                <tr
                  key={ext.marketHashName}
                  className={
                    ext.marketHashName === selected.marketHashName
                      ? "highlight"
                      : undefined
                  }
                >
                  <td className="text-start">{ext.exterior}</td>
                  <td>{ext.sell_listings}</td>
                  <td>{fmt(ext.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!allExteriors.length && (
            <div className="sbc-modal-muted">Нет данных по другим состояниям.</div>
          )}
        </div>

        <div className="sbc-modal-card sbc-modal-card--full">
          <h4>
            На одну редкость ниже
            {lowerRarity ? ` (${lowerRarity})` : ""}
          </h4>
          {lowerError && <div className="sbc-modal-error">{lowerError}</div>}
          {!collection ? (
            <div className="sbc-modal-muted">
              Невозможно определить коллекцию для загрузки данных.
            </div>
          ) : !lowerRarity ? (
            <div className="sbc-modal-muted">
              Для {selected.rarity} нет более низкой редкости.
            </div>
          ) : lowerLoading ? (
            <div className="sbc-modal-muted">Загрузка…</div>
          ) : lowerRows.length ? (
            <table className="sbc-modal-table">
              <thead>
                <tr>
                  <th className="text-start">Скин</th>
                  <th className="text-start">Состояние</th>
                  <th>Листов</th>
                  <th>Цена</th>
                </tr>
              </thead>
              <tbody>
                {lowerRows.map((row) => (
                  <tr key={row.marketHashName}>
                    <td className="text-start">{row.baseName}</td>
                    <td className="text-start">{row.exterior}</td>
                    <td>{row.sellListings ?? "—"}</td>
                    <td>{fmt(row.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="sbc-modal-muted">
              В коллекции нет предметов редкости {lowerRarity}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SkinModal;
