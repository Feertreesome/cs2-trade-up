import React from "react";
import "./SkinsBrowser.css";
import ControlsBar from "./components/ControlsBar";
import ProgressBar from "./components/ProgressBar";
import FlatTable from "./components/FlatTable";
import AggTable from "./components/AggTable";
import {
  EXTERIORS,
  RARITIES,
  fetchAllNames,
  batchListingTotals,
  batchPriceOverview,
} from "./services";
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
  const [hasOld, setHasOld] = React.useState(false);
  const [extraProgress, setExtraProgress] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<
    { type: "success" | "error"; text: string } | null
  >(null);

  React.useEffect(() => {
    if (loader.data) {
      try {
        localStorage.setItem("skins_browser_list", JSON.stringify(loader.data));
        setHasOld(true);
      } catch {
        /* ignore */
      }
    }
  }, [loader.data]);

  React.useEffect(() => {
    try {
      const s = localStorage.getItem("skins_browser_list");
      setHasOld(Boolean(s));
    } catch {
      setHasOld(false);
    }
  }, []);

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  }

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

  async function handleShowOldList() {
    setExtraProgress("Loading saved list…");
    try {
      const s = localStorage.getItem("skins_browser_list");
      if (!s) throw new Error("No saved list");
      const parsed = JSON.parse(s);
      loader.setData(parsed);
      showToast("success", "Loaded saved list");
    } catch (e: any) {
      showToast("error", String(e?.message || e));
    } finally {
      setExtraProgress(null);
    }
  }

  async function handleCheckZero() {
    if (!loader.data) {
      showToast("error", "Nothing to check");
      return;
    }
    setExtraProgress("Checking listings…");
    try {
      const zeroNames = new Set<string>();
      const priceNames = new Set<string>();
      const d: any = loader.data;
      if ("skins" in d) {
        d.skins.forEach((s: any) =>
          s.exteriors.forEach((e: any) => {
            if (!e.sell_listings) zeroNames.add(e.marketHashName);
            if (e.price == null) priceNames.add(e.marketHashName);
          }),
        );
      } else if ("items" in d) {
        d.items.forEach((i: any) => {
          if (!i.sell_listings) zeroNames.add(i.market_hash_name);
          if (i.price == null) priceNames.add(i.market_hash_name);
        });
      }
      const [totals, prices] = await Promise.all([
        zeroNames.size ? batchListingTotals(Array.from(zeroNames)) : ({} as any),
        priceNames.size ? batchPriceOverview(Array.from(priceNames)) : ({} as any),
      ]);
      if ("skins" in d) {
        d.skins.forEach((s: any) =>
          s.exteriors.forEach((e: any) => {
            const n = (totals as any)[e.marketHashName];
            if (typeof n === "number") e.sell_listings = n;
            const p = (prices as any)[e.marketHashName];
            if (typeof p === "number") e.price = p;
          }),
        );
      } else if ("items" in d) {
        d.items.forEach((i: any) => {
          const n = (totals as any)[i.market_hash_name];
          if (typeof n === "number") i.sell_listings = n;
          const p = (prices as any)[i.market_hash_name];
          if (typeof p === "number") i.price = p;
        });
      }
      loader.setData({ ...d });
      showToast("success", "Check complete");
    } catch (e: any) {
      showToast("error", String(e?.message || e));
    } finally {
      setExtraProgress(null);
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
        onShowOldList={handleShowOldList}
        onCheckZero={handleCheckZero}
        hasOldList={hasOld}
        loading={loader.loading || savingNames || Boolean(extraProgress)}
      />

      {(loader.progress || extraProgress || loader.loading) && (
        <ProgressBar text={loader.progress || extraProgress || "Loading…"} />
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
      {toast && (
        <div className={`toast ${toast.type}`} style={{ marginTop: 8 }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
