import React from "react";
import "./SkinsBrowser.css";
import ControlsBar from "./components/ControlsBar";
import ProgressBar from "./components/ProgressBar";
import FlatTable from "./components/FlatTable";
import AggTable from "./components/AggTable";
import { EXTERIORS, RARITIES, fetchAllNames } from "./services";
import useSkinsBrowser from "./hooks/useSkinsBrowser";

export default function SkinsBrowser() {
  const {
    rarity,
    setRarity,
    aggregate,
    setAggregate,
    normalOnly,
    setNormalOnly,
    expandExteriors,
    setExpandExteriors,
    loader,
  } = useSkinsBrowser();

  const [savingNames, setSavingNames] = React.useState(false);
  const [namesMessage, setNamesMessage] = React.useState<string | null>(null);
  const [namesError, setNamesError] = React.useState<string | null>(null);

  async function handleFetchNames() {
    setSavingNames(true);
    setNamesMessage(null);
    setNamesError(null);
    try {
      const result = await fetchAllNames(rarity, normalOnly);
      setNamesMessage(`Saved ${result.total} names for ${result.rarity}`);
    } catch (e: any) {
      setNamesError(String(e?.message || e));
    } finally {
      setSavingNames(false);
    }
  }

  const viewData = loader.data;

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
        aggregate={aggregate}
        setAggregate={setAggregate}
        normalOnly={normalOnly}
        setNormalOnly={setNormalOnly}
        expandExteriors={expandExteriors}
        setExpandExteriors={setExpandExteriors}
        expandOptions={["none", "price", "all"]}
        onLoadProgressive={loader.loadProgressive}
        onFetchNames={handleFetchNames}
        loading={loader.loading || savingNames}
      />

      {(loader.progress || loader.loading) && (
        <ProgressBar text={loader.progress || "Loading…"} />
      )}
      {loader.error && (
        <div className="red" style={{ marginTop: 8 }}>
          {loader.error}
        </div>
      )}
      {namesError && (
        <div className="red" style={{ marginTop: 8 }}>
          {namesError}
        </div>
      )}
      {namesMessage && (
        <div className="small" style={{ marginTop: 8 }}>
          {namesMessage}
        </div>
      )}
      {!loader.loading && viewData && "skins" in viewData && (
        <>
          <AggTable skins={viewData.skins} />
          <div className="small" style={{ marginTop: 8 }}>
            Items: {viewData.total}
          </div>
        </>
      )}
      {!loader.loading && viewData && "items" in viewData && (
        <>
          <FlatTable items={viewData.items} />
          <div className="small" style={{ marginTop: 8 }}>
            Items: {viewData.total}
          </div>
        </>
      )}
      {!loader.loading && !viewData && !loader.error && (
        <div className="small" style={{ marginTop: 8 }}>
          Pick params and compute. EXTERIORS: {EXTERIORS.join(" / ")}.
        </div>
      )}
    </div>
  );
}
