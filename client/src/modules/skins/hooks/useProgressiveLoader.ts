import { useState } from "react";
import {
  EXTERIORS,
  aggregateFromFlat,
  batchListingTotals,
  batchPriceOverview,
  fetchTotals,
  type ApiAggResp,
  type ApiFlatResp,
  type ExpandMode,
  type Rarity,
} from "../services";

type Params = {
  rarity: Rarity;
  aggregate: boolean;
  normalOnly: boolean;
  expandExteriors: ExpandMode;
};

export default function useProgressiveLoader(params: Params) {
  const { rarity, aggregate, normalOnly, expandExteriors } = params;
  const [data, setData] = useState<ApiAggResp | ApiFlatResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 30;
  const pageDelayMs = 2600;

  async function fetchPageWithRetry(url: string) {
    let attempt = 0;
    while (true) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e: any) {
        attempt++;
        const retriable = /HTTP 429|HTTP 5\d{2}/.test(String(e?.message || e));
        if (!retriable || attempt >= 8) throw e;
        const backoff = Math.min(60000, 2000 * Math.pow(2, attempt - 1));
        setProgress(`Rate-limited. Retry in ${(backoff/1000).toFixed(0)}s…`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }

  async function loadProgressive() {
    setLoading(true); setError(null); setData(null); setProgress("Preparing…");
    try {
      const totals = await fetchTotals([rarity], normalOnly);
      const total = totals.totals[rarity] ?? 0;

      const flat: any[] = [];
      for (let start = 0; start < total; start += pageSize) {
        setProgress(`Loading ${start + 1}–${Math.min(start + pageSize, total)} / ${total}`);
        const j = await fetchPageWithRetry(
          `/api/skins/paged?rarity=${encodeURIComponent(rarity)}&start=${start}&count=${pageSize}&normalOnly=${normalOnly ? "1" : "0"}`
        );
        flat.push(...j.items.map((i: any) => ({ ...i, rarity })));
        await new Promise(r => setTimeout(r, pageDelayMs));
      }

      if (!aggregate) {
        const out: ApiFlatResp = { rarities: [rarity], total: flat.length, items: flat };
        const missing = flat.filter(x => x.price == null).map(x => x.market_hash_name);
        if (missing.length) {
          const pmap = await batchPriceOverview(Array.from(new Set(missing)));
          out.items.forEach(x => { if (x.price == null) (x as any).price = pmap[x.market_hash_name] ?? null; });
        }
        setData(out); setProgress(null);
        return;
      }

      const groups = aggregateFromFlat(flat, rarity);

      // expand exteriors
      const needPriceCheck: string[] = [];
      Object.values(groups).forEach(g => {
        const present = new Set(g.exteriors.map(e => e.exterior));
        if (expandExteriors === "all" || expandExteriors === "price") {
          for (const ext of EXTERIORS) {
            if (present.has(ext)) continue;
            const mhn = `${g.baseName} (${ext})`;
            if (expandExteriors === "all") {
              g.exteriors.push({ exterior: ext, marketHashName: mhn, sell_listings: 0, price: null });
            } else {
              needPriceCheck.push(mhn);
            }
          }
        }
      });
      if (expandExteriors === "price" && needPriceCheck.length) {
        const pmap = await batchPriceOverview(needPriceCheck);
        Object.values(groups).forEach(g => {
          for (const ext of EXTERIORS) {
            if (g.exteriors.some(e => e.exterior === ext)) continue;
            const mhn = `${g.baseName} (${ext})`;
            const p = pmap[mhn];
            if (p != null) g.exteriors.push({ exterior: ext, marketHashName: mhn, sell_listings: 0, price: p });
          }
        });
      }

      // prices for all
      const toPrice = Object.values(groups).flatMap(g => g.exteriors.filter(e => e.price == null).map(e => e.marketHashName));
      if (toPrice.length) {
        const pmap = await batchPriceOverview(Array.from(new Set(toPrice)));
        Object.values(groups).forEach(g => g.exteriors.forEach(e => { if (e.price == null) e.price = pmap[e.marketHashName] ?? null; }));
      }

      // fix zero listings with listing totals
      const needTotals = Object.values(groups).flatMap(g => g.exteriors.filter(e => e.sell_listings === 0).map(e => e.marketHashName));
      if (needTotals.length) {
        const tmap = await batchListingTotals(Array.from(new Set(needTotals)));
        Object.values(groups).forEach(g => g.exteriors.forEach(e => {
          const n = tmap[e.marketHashName];
          if (typeof n === "number" && n > e.sell_listings) e.sell_listings = n;
        }));
      }

      const skins = Object.values(groups).sort((a, b) => a.baseName.localeCompare(b.baseName));
      const out: ApiAggResp = { rarities: [rarity], total: skins.length, skins };
      setData(out); setProgress(null);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  return {
    data,
    loading,
    progress,
    error,
    loadProgressive,
    setData,
  };
}
