import type { Rarity, SkinDetails } from "./types";

export async function fetchTotals(rarities: Rarity[], normalOnly: boolean, maxRetries = 4) {
  const qs = new URLSearchParams({
    rarities: rarities.join(","), normalOnly: normalOnly ? "1" : "0"
  });
  let attempt = 0;
  while (true) {
    try {
      const r = await fetch(`/api/skins/totals?${qs.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{ rarities: Rarity[]; totals: Record<Rarity, number>; sum: number }>;
    } catch (e: any) {
      attempt++;
      const retriable = /HTTP 429|HTTP 5\d{2}/.test(String(e?.message || e));
      if (!retriable || attempt >= maxRetries) throw e;
      const backoff = Math.min(15000, 1500 * Math.pow(2, attempt - 1));
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

export async function fetchAllNames(rarity: Rarity, normalOnly: boolean, maxRetries = 4) {
  const qs = new URLSearchParams({ rarity, normalOnly: normalOnly ? "1" : "0" });
  let attempt = 0;
  while (true) {
    try {
      const r = await fetch(`/api/skins/names?${qs.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{ rarity: Rarity; names: string[]; total: number }>;
    } catch (e: any) {
      attempt++;
      const retriable = /HTTP 429|HTTP 5\d{2}/.test(String(e?.message || e));
      if (!retriable || attempt >= maxRetries) throw e;
      const backoff = Math.min(15000, 1500 * Math.pow(2, attempt - 1));
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

export async function batchPriceOverview(names: string[], chunk = 20, maxRetries = 4) {
  const out: Record<string, number | null> = {};
  for (let i = 0; i < names.length; i += chunk) {
    const slice = names.slice(i, i + chunk);
    let attempt = 0;
    while (true) {
      try {
        const r = await fetch("/api/priceoverview/batch", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names: slice })
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        Object.assign(out, j.prices || {});
        break;
      } catch (e: any) {
        attempt++;
        const retriable = /HTTP 429|HTTP 5\d{2}/.test(String(e?.message || e));
        if (!retriable || attempt >= maxRetries) throw e;
        const backoff = Math.min(15000, 1500 * Math.pow(2, attempt - 1));
        await new Promise(r => setTimeout(r, backoff));
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return out;
}

export async function batchListingTotals(names: string[], chunk = 20, maxRetries = 4) {
  const out: Record<string, number | null> = {};
  for (let i = 0; i < names.length; i += chunk) {
    const slice = names.slice(i, i + chunk);
    let attempt = 0;
    while (true) {
      try {
        const r = await fetch("/api/skins/listing-totals", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names: slice })
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        Object.assign(out, j.totals || {});
        break;
      } catch (e: any) {
        attempt++;
        const retriable = /HTTP 429|HTTP 5\d{2}/.test(String(e?.message || e));
        if (!retriable || attempt >= maxRetries) throw e;
        const backoff = Math.min(15000, 1500 * Math.pow(2, attempt - 1));
        await new Promise(r => setTimeout(r, backoff));
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return out;
}

export async function fetchSkinDetails(params: {
  marketHashName: string;
  rarity: Rarity;
}) {
  const query = new URLSearchParams({
    marketHashName: params.marketHashName,
    rarity: params.rarity,
  });
  const response = await fetch(`/api/skins/details?${query.toString()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<SkinDetails>;
}
