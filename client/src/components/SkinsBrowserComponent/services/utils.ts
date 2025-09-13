import type { Exterior, AggGroup, FlatItem, Rarity } from "./types";

export function parseExterior(mhn: string): Exterior {
  const m = mhn.match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i);
  return (m?.[1] as Exterior) ?? "Field-Tested";
}
export function baseFromMhn(mhn: string) {
  return mhn.replace(/ \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i, "");
}

export function aggregateFromFlat(flat: FlatItem[], rarity: Rarity): Record<string, AggGroup> {
  const map: Record<string, AggGroup> = {};
  for (const it of flat) {
    const base = baseFromMhn(it.market_hash_name);
    const ext = parseExterior(it.market_hash_name);
    const key = `${rarity}::${base}`;
    if (!map[key]) map[key] = { baseName: base, rarity, exteriors: [] };
    map[key].exteriors.push({
      exterior: ext, marketHashName: it.market_hash_name,
      sell_listings: it.sell_listings, price: (it as any).price ?? null
    });
  }
  return map;
}
