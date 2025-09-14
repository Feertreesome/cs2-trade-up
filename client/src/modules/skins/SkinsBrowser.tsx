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
    actualPrices,
    setActualPrices,
    actualListings,
    setActualListings,
    loader,
  } = useSkinsBrowser();

  const [savingNames, setSavingNames] = React.useState(false);
  const [namesMessage, setNamesMessage] = React.useState<string | null>(null);
  const [namesError, setNamesError] = React.useState<string | null>(null);
  const [oldListDate, setOldListDate] = React.useState<string | null>(null);
  const [extraProgress, setExtraProgress] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<
    { type: "success" | "error"; text: string } | null
  >(null);
  const skipSaveRef = React.useRef(false);

  React.useEffect(() => {
    if (!loader.loading && loader.data && !skipSaveRef.current) {
      try {
        localStorage.setItem("skins_browser_list", JSON.stringify(loader.data));
        const now = new Date().toISOString();
        localStorage.setItem("skins_browser_list_date", now);
        setOldListDate(now);
      } catch {
        /* ignore */
      }
    }
    if (!loader.loading) {
      skipSaveRef.current = false;
    }
  }, [loader.loading, loader.data]);

  React.useEffect(() => {
    try {
      const d = localStorage.getItem("skins_browser_list_date");
      setOldListDate(d);
    } catch {
      setOldListDate(null);
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
      const d = localStorage.getItem("skins_browser_list_date");
      if (!s || !d) throw new Error("No saved list");
      const parsed = JSON.parse(s);
      skipSaveRef.current = true;
      loader.setData(parsed);
      setOldListDate(d);
      showToast("success", "Loaded saved list");
    } catch (e: any) {
      showToast("error", String(e?.message || e));
    } finally {
      setExtraProgress(null);
    }
  }

  async function handleAddCorrectPrice() {
    if (!loader.data) {
      showToast("error", "Nothing to update");
      return;
    }
    setExtraProgress("Updating prices…");
    try {
      const names = new Set<string>();
      const d: any = loader.data;
      if ("skins" in d) {
        d.skins.forEach((s: any) => s.exteriors.forEach((e: any) => names.add(e.marketHashName)));
      } else if ("items" in d) {
        d.items.forEach((i: any) => names.add(i.market_hash_name));
      }
      const prices = await batchPriceOverview(Array.from(names));
      if ("skins" in d) {
        d.skins.forEach((s: any) =>
          s.exteriors.forEach((e: any) => {
            const p = (prices as any)[e.marketHashName];
            if (typeof p === "number") e.price = p;
          }),
        );
      } else if ("items" in d) {
        d.items.forEach((i: any) => {
          const p = (prices as any)[i.market_hash_name];
          if (typeof p === "number") i.price = p;
        });
      }
      loader.setData({ ...d });
      showToast("success", "Prices updated");
    } catch (e: any) {
      showToast("error", String(e?.message || e));
    } finally {
      setExtraProgress(null);
    }
  }

  async function handleFixZeroPrice() {
    if (!loader.data) {
      showToast("error", "Nothing to fix");
      return;
    }
    setExtraProgress("Fixing prices…");
    try {
      const names = new Set<string>();
      const d: any = loader.data;
      if ("skins" in d) {
        d.skins.forEach((s: any) =>
          s.exteriors.forEach((e: any) => {
            if (e.price == null || e.price === 0) names.add(e.marketHashName);
          }),
        );
      } else if ("items" in d) {
        d.items.forEach((i: any) => {
          if (i.price == null || i.price === 0) names.add(i.market_hash_name);
        });
      }
      if (names.size) {
        const prices = await batchPriceOverview(Array.from(names));
        if ("skins" in d) {
          d.skins.forEach((s: any) =>
            s.exteriors.forEach((e: any) => {
              const p = (prices as any)[e.marketHashName];
              if (typeof p === "number") e.price = p;
            }),
          );
        } else if ("items" in d) {
          d.items.forEach((i: any) => {
            const p = (prices as any)[i.market_hash_name];
            if (typeof p === "number") i.price = p;
          });
        }
        loader.setData({ ...d });
      }
      showToast("success", "Prices fixed");
    } catch (e: any) {
      showToast("error", String(e?.message || e));
    } finally {
      setExtraProgress(null);
    }
  }

  async function handleAddCorrectListings() {
    if (!loader.data) {
      showToast("error", "Nothing to update");
      return;
    }
    setExtraProgress("Updating listings…");
    try {
      const names = new Set<string>();
      const d: any = loader.data;
      if ("skins" in d) {
        d.skins.forEach((s: any) => s.exteriors.forEach((e: any) => names.add(e.marketHashName)));
      } else if ("items" in d) {
        d.items.forEach((i: any) => names.add(i.market_hash_name));
      }
      const totals = await batchListingTotals(Array.from(names));
      if ("skins" in d) {
        d.skins.forEach((s: any) =>
          s.exteriors.forEach((e: any) => {
            const n = (totals as any)[e.marketHashName];
            if (typeof n === "number") e.sell_listings = n;
          }),
        );
      } else if ("items" in d) {
        d.items.forEach((i: any) => {
          const n = (totals as any)[i.market_hash_name];
          if (typeof n === "number") i.sell_listings = n;
        });
      }
      loader.setData({ ...d });
      showToast("success", "Listings updated");
    } catch (e: any) {
      showToast("error", String(e?.message || e));
    } finally {
      setExtraProgress(null);
    }
  }

  async function handleFixZeroListings() {
    if (!loader.data) {
      showToast("error", "Nothing to fix");
      return;
    }
    setExtraProgress("Fixing listings…");
    try {
      const names = new Set<string>();
      const d: any = loader.data;
      if ("skins" in d) {
        d.skins.forEach((s: any) =>
          s.exteriors.forEach((e: any) => {
            if (!e.sell_listings) names.add(e.marketHashName);
          }),
        );
      } else if ("items" in d) {
        d.items.forEach((i: any) => {
          if (!i.sell_listings) names.add(i.market_hash_name);
        });
      }
      if (names.size) {
        const totals = await batchListingTotals(Array.from(names));
        if ("skins" in d) {
          d.skins.forEach((s: any) =>
            s.exteriors.forEach((e: any) => {
              const n = (totals as any)[e.marketHashName];
              if (typeof n === "number") e.sell_listings = n;
            }),
          );
        } else if ("items" in d) {
          d.items.forEach((i: any) => {
            const n = (totals as any)[i.market_hash_name];
            if (typeof n === "number") i.sell_listings = n;
          });
        }
        loader.setData({ ...d });
      }
      showToast("success", "Listings fixed");
    } catch (e: any) {
      showToast("error", String(e?.message || e));
    } finally {
      setExtraProgress(null);
    }
  }

  const viewData = loader.data;

  return (
    <div className="card sbc p-3">
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
        actualPrices={actualPrices}
        setActualPrices={setActualPrices}
        actualListings={actualListings}
        setActualListings={setActualListings}
        expandOptions={["none", "price", "all"]}
        onLoadProgressive={loader.loadProgressive}
        onFetchNames={handleFetchNames}
        onShowOldList={handleShowOldList}
        onAddCorrectPrice={handleAddCorrectPrice}
        onFixZeroPrice={handleFixZeroPrice}
        onAddCorrectListings={handleAddCorrectListings}
        onFixZeroListings={handleFixZeroListings}
        oldListDate={oldListDate}
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
      {viewData && "skins" in viewData && (
        <>
          <div className="small" style={{ marginTop: 8 }}>
            Items: {viewData.total}
            {loader.elapsedMs != null && ` | Time: ${(loader.elapsedMs / 1000).toFixed(1)}s`}
          </div>
          <AggTable skins={viewData.skins} />
        </>
      )}
      {viewData && "items" in viewData && (
        <>
          <div className="small" style={{ marginTop: 8 }}>
            Items: {viewData.total}
            {loader.elapsedMs != null && ` | Time: ${(loader.elapsedMs / 1000).toFixed(1)}s`}
          </div>
          <FlatTable items={viewData.items} />
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
