import { RARITY_TO_TAG, searchByRarity } from "../steam/repo";
import { type Exterior } from "./types";

/** Supported rarities extracted from Steam mapping. */
export const ALL_RARITIES = Object.keys(RARITY_TO_TAG) as (keyof typeof RARITY_TO_TAG)[];

/** Extracts exterior from a market_hash_name, defaults to Field-Tested. */
export const parseMarketHashExterior = (marketHashName: string): Exterior => {
  const match = marketHashName.match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i);
  return (match?.[1] as Exterior) ?? "Field-Tested";
};

/** Removes exterior suffix, returning the base item name. */
export const baseFromMarketHash = (marketHashName: string): string =>
  marketHashName.replace(/ \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i, "");

/**
 * Fetches total_count for each rarity with minimal requests.
 */
export const getTotals = async (
  rarities: (keyof typeof RARITY_TO_TAG)[],
  normalOnly: boolean,
): Promise<{ perRarity: Record<string, number>; sum: number }> => {
  const perRarity: Record<string, number> = {};
  let sum = 0;
  for (const rarity of rarities) {
    const { total } = await searchByRarity({ rarity, start: 0, count: 1, normalOnly });
    perRarity[rarity] = total;
    sum += total;
  }
  return { perRarity, sum };
};
