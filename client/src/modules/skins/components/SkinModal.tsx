import React from "react";
import {
  EXTERIORS,
  batchPriceOverview,
  type AggGroup,
  type Exterior,
  type Rarity,
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
  const currentIndex = React.useMemo(
    () =>
      allExteriors.findIndex(
        (ext) =>
          ext.marketHashName === selected.marketHashName ||
          ext.exterior === selected.exterior,
      ),
    [allExteriors, selected],
  );
  const lowerExterior =
    currentIndex >= 0 && currentIndex + 1 < allExteriors.length
      ? allExteriors[currentIndex + 1]
      : null;

  const { weapon, skin } = React.useMemo(
    () => extractNames(selected.baseName),
    [selected.baseName],
  );
  const { price, loading, error } = useActualPrice(selected);

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
          <div className="sbc-modal-card">
            <h4>Информация</h4>
            <div className="sbc-modal-info">
              <div>
                <div className="label">Коллекция</div>
                <div>{skin}</div>
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
            </div>
          </div>

          <div className="sbc-modal-card">
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
        </div>

        <div className="sbc-modal-card" style={{ marginTop: 16 }}>
          <h4>На одно качество ниже</h4>
          {lowerExterior ? (
            <table className="sbc-modal-table">
              <thead>
                <tr>
                  <th className="text-start">Состояние</th>
                  <th>Листов</th>
                  <th>Цена</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-start">{lowerExterior.exterior}</td>
                  <td>{lowerExterior.sell_listings}</td>
                  <td>{fmt(lowerExterior.price)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="sbc-modal-muted">
              Для этого скина нет более низкого качества.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SkinModal;
