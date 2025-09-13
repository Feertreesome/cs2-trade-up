import React, { useMemo, useState } from "react";
import "./SkinsBrowserComponent.css";
import ControlsBar from "./components/ControlsBar";
import ProgressBar from "./components/ProgressBar";
import FlatTable from "./components/FlatTable";
import AggTable from "./components/AggTable";
import {
  EXTERIORS,
  RARITIES,
  type ExpandMode,
  type Rarity,
  type ApiAggResp,
  type ApiFlatResp,
} from "./services/types";
import { fetchSkins } from "./services/api";
import useProgressiveLoader from "./hooks/useProgressiveLoader";

export default function SkinsBrowserComponent() {
  const [rarity, setRarity] = useState<Rarity>("Classified");
  const [aggregate, setAggregate] = useState(true);
  const [prices, setPrices] = useState(false);
  const [normalOnly, setNormalOnly] = useState(true);
  const [expandExteriors, setExpandExteriors] = useState<ExpandMode>("price");
  const [limit, setLimit] = useState(100);

  const [data, setData] = useState<ApiAggResp | ApiFlatResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prog = useProgressiveLoader({
    rarity,
    aggregate,
    prices,
    normalOnly,
    expandExteriors,
  });

  async function onLoad() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const resp = await fetchSkins({
        rarities: [rarity],
        limit,
        aggregate,
        prices,
        normalOnly,
        expandExteriors,
      });
      setData(resp);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  const canResume = prog.canResume;
  const meta = (data as any)?.meta ?? null;

  const hint = useMemo(() => {
    if (!data) return "Choose params and click Load or Load progressively.";
    if (meta) {
      return `Totals: ${Object.entries(meta.totals || {})
        .map(([k, v]) => `${k}=${v}`)
        .join(
          ", ",
        )} • Recommended: ${meta.recommendedLimit} • Applied: ${meta.appliedLimit}${meta.capped ? " (capped)" : ""}`;
    }
    return null;
  }, [data]);

  return (
    <div className="card sbc">
      <div className="h1">Skins Browser</div>
      <div className="small">
        Fetch skins by rarity from Steam Market. Progressive mode avoids rate
        limits and fills missing exteriors.
      </div>

      <ControlsBar
        rarity={rarity}
        setRarity={setRarity}
        rarityOptions={RARITIES}
        limit={limit}
        setLimit={setLimit}
        aggregate={aggregate}
        setAggregate={setAggregate}
        prices={prices}
        setPrices={setPrices}
        normalOnly={normalOnly}
        setNormalOnly={setNormalOnly}
        expandExteriors={expandExteriors}
        setExpandExteriors={setExpandExteriors}
        expandOptions={["none", "price", "all"]}
        onLoad={onLoad}
        onLoadProgressive={prog.loadProgressive}
        onResume={prog.resume}
        loading={loading || prog.loading}
        canResume={canResume}
      />

      {(prog.progress || prog.loading) && (
        <ProgressBar text={prog.progress || "Loading…"} />
      )}
      {error && (
        <div className="red" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {prog.error && (
        <div className="red" style={{ marginTop: 8 }}>
          {prog.error}
        </div>
      )}
      {hint && (
        <div className="small" style={{ marginTop: 8 }}>
          {hint}
        </div>
      )}

      {!prog.loading && !loading && data && "skins" in data && (
        <>
          <AggTable skins={data.skins} />
          <div className="small" style={{ marginTop: 8 }}>
            Items: {data.total}
          </div>
        </>
      )}
      {!prog.loading && !loading && data && "items" in data && (
        <>
          <FlatTable items={data.items} />
          <div className="small" style={{ marginTop: 8 }}>
            Items: {data.total}
          </div>
        </>
      )}

      {!prog.loading && !loading && !data && !error && !prog.error && (
        <div className="small" style={{ marginTop: 8 }}>
          Pick params and compute. EXTERIORS: {EXTERIORS.join(" / ")}.
        </div>
      )}
    </div>
  );
}
