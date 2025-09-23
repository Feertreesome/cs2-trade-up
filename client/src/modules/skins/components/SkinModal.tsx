import React from "react";
import {
  EXTERIORS,
  fetchSkinDetails,
  type AggGroup,
  type Exterior,
  type Rarity,
  type SkinDetails,
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
): AggGroup["exteriors"] =>
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

type ExteriorRow = {
  exterior: Exterior;
  marketHashName: string;
  price: number | null;
  sellListings: number | null;
};

const mapFallbackExteriors = (
  group: AggGroup,
): ExteriorRow[] =>
  orderByExterior(group.exteriors).map((ext) => ({
    exterior: ext.exterior,
    marketHashName: ext.marketHashName,
    price: ext.price ?? null,
    sellListings: ext.sell_listings ?? null,
  }));

const useSkinDetails = (selected: SkinSummary) => {
  const [data, setData] = React.useState<SkinDetails | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    fetchSkinDetails({
      marketHashName: selected.marketHashName,
      rarity: selected.rarity,
    })
      .then((details) => {
        if (!cancelled) setData(details);
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
  }, [selected.marketHashName, selected.rarity]);

  return { data, loading, error } as const;
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

const sortExteriors = (rows: ExteriorRow[]) =>
  rows
    .slice()
    .sort(
      (a, b) =>
        EXTERIORS.indexOf(a.exterior) - EXTERIORS.indexOf(b.exterior),
    );

const SkinModal: React.FC<Props> = ({ selected, group, onClose }) => {
  useModalLifecycle(onClose);

  const resolvedGroup = React.useMemo(
    () => normalizeGroup(selected, group),
    [selected, group],
  );
  const fallbackExteriors = React.useMemo(
    () => mapFallbackExteriors(resolvedGroup),
    [resolvedGroup],
  );
  const { weapon, skin } = React.useMemo(
    () => extractNames(selected.baseName),
    [selected.baseName],
  );
  const {
    data: details,
    loading: detailsLoading,
    error: detailsError,
  } = useSkinDetails(selected);

  const exteriorRows = React.useMemo(() => {
    if (details?.exteriors?.length) {
      return sortExteriors(details.exteriors);
    }
    return fallbackExteriors;
  }, [details, fallbackExteriors]);

  const collectionLabel = detailsLoading
    ? "Загрузка…"
    : details?.collection ?? "Неизвестно";

  const sameRarityList = React.useMemo(() => {
    if (!details?.sameRarity?.length) return [];
    const unique = Array.from(new Set(details.sameRarity));
    unique.sort((a, b) => a.localeCompare(b));
    return unique;
  }, [details]);

  const lowerSection = details?.lowerRarity ?? null;
  const displayPrice = detailsLoading
    ? null
    : details?.price ?? selected.price ?? null;
  const displayListings = detailsLoading
    ? selected.sellListings
    : details?.sellListings ?? selected.sellListings;

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
                <div>{collectionLabel}</div>
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
                <div>{displayListings}</div>
              </div>
              <div>
                <div className="label">Актуальная цена</div>
                <div
                  className={`sbc-modal-price${detailsLoading ? " loading" : ""}`}
                >
                  {detailsLoading ? "Загрузка…" : fmt(displayPrice)}
                </div>
              </div>
              {detailsError && (
                <div className="sbc-modal-error">{detailsError}</div>
              )}
            </div>
          </div>

          <div className="sbc-modal-card sbc-modal-card--list">
            <h4>Скины этой редкости</h4>
            {detailsLoading ? (
              <div className="sbc-modal-muted">Загрузка…</div>
            ) : !details?.collection ? (
              <div className="sbc-modal-muted">
                Коллекция не найдена для этого предмета.
              </div>
            ) : sameRarityList.length ? (
              <ul className="sbc-modal-list">
                {sameRarityList.map((name) => (
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
              {exteriorRows.map((ext) => (
                <tr
                  key={ext.marketHashName}
                  className={
                    ext.marketHashName === selected.marketHashName
                      ? "highlight"
                      : undefined
                  }
                >
                  <td className="text-start">{ext.exterior}</td>
                  <td>{ext.sellListings ?? "—"}</td>
                  <td>{fmt(ext.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!exteriorRows.length && (
            <div className="sbc-modal-muted">Нет данных по другим состояниям.</div>
          )}
        </div>

        <div className="sbc-modal-card sbc-modal-card--full">
          <h4>
            На одну редкость ниже
            {lowerSection?.rarity ? ` (${lowerSection.rarity})` : ""}
          </h4>
          {!details?.collection ? (
            <div className="sbc-modal-muted">
              Невозможно определить коллекцию для загрузки данных.
            </div>
          ) : detailsLoading ? (
            <div className="sbc-modal-muted">Загрузка…</div>
          ) : !lowerSection ? (
            <div className="sbc-modal-muted">
              Для {selected.rarity} нет более низкой редкости.
            </div>
          ) : lowerSection.items.length ? (
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
                {lowerSection.items.map((row) => (
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
              В коллекции нет предметов редкости {lowerSection.rarity}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SkinModal;
