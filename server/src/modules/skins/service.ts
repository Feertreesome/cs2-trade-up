import { RARITY_TO_TAG, searchByRarity, type SearchItem } from "../steam/repo";
import {
  getRarityTotalsFromDb,
  getSkinsPageFromDb,
  getNamesByRarityFromDb,
} from "../../database/collections";
import { isCatalogReady } from "../../database/status";

export type Exterior =
  | "Factory New"
  | "Minimal Wear"
  | "Field-Tested"
  | "Well-Worn"
  | "Battle-Scarred";

/** Supported rarities extracted from Steam mapping. */
export const ALL_RARITIES = Object.keys(
  RARITY_TO_TAG,
) as (keyof typeof RARITY_TO_TAG)[];

/** Extracts exterior from a market_hash_name, defaults to Field-Tested. */
export const parseMarketHashExterior = (marketHashName: string): Exterior => {
  const match = marketHashName.match(
    /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i,
  );
  return (match?.[1] as Exterior) ?? "Field-Tested";
};

/** Removes exterior suffix, returning the base item name. */
export const baseFromMarketHash = (marketHashName: string): string =>
  marketHashName.replace(
    / \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i,
    "",
  );

/**
 * Fetches total_count for each rarity with minimal requests.
 */
export const getTotals = async (
  rarities: (keyof typeof RARITY_TO_TAG)[],
  normalOnly: boolean,
): Promise<{ perRarity: Record<string, number>; sum: number }> => {
  if (await isCatalogReady()) {
    try {
      const stored = await getRarityTotalsFromDb(rarities, normalOnly);
      if (stored) {
        const perRarity: Record<string, number> = {};
        let sum = 0;
        for (const rarity of rarities) {
          const count = stored.perRarity[rarity] ?? 0;
          perRarity[rarity] = count;
          sum += count;
        }
        return { perRarity, sum };
      }
    } catch (error) {
      // fall back to live Steam data
    }
  }
  const perRarity: Record<string, number> = {};
  let sum = 0;
  const concurrency = 5;
  for (let i = 0; i < rarities.length; i += concurrency) {
    const slice = rarities.slice(i, i + concurrency);
    const totals = await Promise.all(
      slice.map((rarity) =>
        searchByRarity({ rarity, start: 0, count: 1, normalOnly }),
      ),
    );
    slice.forEach((rarity, idx) => {
      const total = totals[idx].total;
      perRarity[rarity] = total;
      sum += total;
    });
  }
  return { perRarity, sum };
};

export const getSkinsPage = async (
  options: {
    rarity: (keyof typeof RARITY_TO_TAG);
    start: number;
    count: number;
    normalOnly: boolean;
  },
): Promise<{ total: number; items: SearchItem[] }> => {
  const { rarity, start, count, normalOnly } = options;
  if (await isCatalogReady()) {
    try {
      const stored = await getSkinsPageFromDb(rarity, start, count, normalOnly);
      if (stored) {
        return stored;
      }
    } catch (error) {
      // fall back to live Steam data
    }
  }
  return searchByRarity({ rarity, start, count, normalOnly });
};

export const getPersistedNames = async (
  rarity: (keyof typeof RARITY_TO_TAG),
  normalOnly: boolean,
): Promise<string[] | null> => {
  if (await isCatalogReady()) {
    try {
      const names = await getNamesByRarityFromDb(rarity, normalOnly);
      if (Array.isArray(names)) {
        return names;
      }
    } catch (error) {
      // fall back to live Steam data
    }
  }
  return null;
};
