import { getPriceUSD, fetchListingInfo, searchByCollection, RARITY_TO_TAG, type SearchItem } from "../steam/repo";
import { baseFromMarketHash, type Exterior, ALL_RARITIES } from "./service";

type Rarity = (typeof ALL_RARITIES)[number];

const EXTERIORS_ORDER: Exterior[] = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
];

const EXTERIOR_SUFFIXES = EXTERIORS_ORDER.map((exterior) => ` (${exterior})`);

const LOWER_RARITY_MAP: Record<Rarity, Rarity | null> = {
  Covert: "Classified",
  Classified: "Restricted",
  Restricted: "Mil-Spec",
  "Mil-Spec": null,
};

const tryParseExterior = (marketHashName: string): Exterior | null => {
  for (let i = 0; i < EXTERIOR_SUFFIXES.length; i += 1) {
    if (marketHashName.endsWith(EXTERIOR_SUFFIXES[i])) {
      return EXTERIORS_ORDER[i];
    }
  }
  return null;
};

const sortByExterior = <T extends { exterior: Exterior }>(items: T[]) =>
  items.sort(
    (a, b) =>
      EXTERIORS_ORDER.indexOf(a.exterior) - EXTERIORS_ORDER.indexOf(b.exterior),
  );

const fetchAllCollectionItems = async (
  collectionTag: string,
  rarityTag?: string | null,
) => {
  const items: SearchItem[] = [];
  let start = 0;
  const pageSize = 100;
  for (let guard = 0; guard < 10; guard += 1) {
    const { total, items: chunk } = await searchByCollection({
      collectionTag,
      rarityTag,
      start,
      count: pageSize,
      normalOnly: true,
    });
    if (!chunk.length) break;
    items.push(...chunk);
    start += chunk.length;
    if (start >= total) break;
  }
  return items;
};

export type SkinDetailExterior = {
  exterior: Exterior;
  marketHashName: string;
  price: number | null;
  sellListings: number | null;
};

export type SkinDetailLowerItem = {
  baseName: string;
  exterior: Exterior;
  marketHashName: string;
  price: number | null;
  sellListings: number | null;
};

export type SkinDetails = {
  marketHashName: string;
  baseName: string;
  rarity: Rarity;
  collection: string | null;
  price: number | null;
  sellListings: number | null;
  exteriors: SkinDetailExterior[];
  sameRarity: string[];
  lowerRarity: {
    rarity: Rarity;
    items: SkinDetailLowerItem[];
  } | null;
};

const groupByBase = (items: SearchItem[]) => {
  const grouped = new Map<string, { exterior: Exterior; item: SearchItem }[]>();
  items.forEach((item) => {
    const exterior = tryParseExterior(item.market_hash_name);
    if (!exterior) return;
    const baseName = baseFromMarketHash(item.market_hash_name);
    const bucket = grouped.get(baseName);
    if (bucket) {
      bucket.push({ exterior, item });
    } else {
      grouped.set(baseName, [{ exterior, item }]);
    }
  });
  return grouped;
};

const buildLowerRarity = (
  items: SearchItem[],
): SkinDetailLowerItem[] => {
  const rows: SkinDetailLowerItem[] = [];
  items.forEach((item) => {
    const exterior = tryParseExterior(item.market_hash_name);
    if (!exterior) return;
    rows.push({
      baseName: baseFromMarketHash(item.market_hash_name),
      exterior,
      marketHashName: item.market_hash_name,
      price: item.price ?? null,
      sellListings: item.sell_listings ?? null,
    });
  });
  rows.sort((a, b) => {
    const baseCmp = a.baseName.localeCompare(b.baseName);
    if (baseCmp !== 0) return baseCmp;
    return (
      EXTERIORS_ORDER.indexOf(a.exterior) -
      EXTERIORS_ORDER.indexOf(b.exterior)
    );
  });
  return rows;
};

export const fetchSkinDetails = async ({
  marketHashName,
  rarity,
}: {
  marketHashName: string;
  rarity: Rarity;
}): Promise<SkinDetails> => {
  const [listing, priceResult] = await Promise.all([
    fetchListingInfo(marketHashName),
    getPriceUSD(marketHashName),
  ]);

  const baseName = baseFromMarketHash(marketHashName);
  const collectionTag = listing.asset?.tags?.find(
    (tag) => tag.category === "ItemSet",
  );
  const collectionName = collectionTag?.localized_tag_name ?? null;
  const collectionInternal = collectionTag?.internal_name ?? null;

  const sameRarityItems =
    collectionInternal != null
      ? await fetchAllCollectionItems(
          collectionInternal,
          RARITY_TO_TAG[rarity],
        )
      : [];

  const grouped = groupByBase(sameRarityItems);
  const selectedGroup = grouped.get(baseName) ?? [];
  const exteriors: SkinDetailExterior[] = sortByExterior(
    selectedGroup.map(({ exterior, item }) => ({
      exterior,
      marketHashName: item.market_hash_name,
      price: item.price ?? null,
      sellListings: item.sell_listings ?? null,
    })),
  );

  const selectedExterior = tryParseExterior(marketHashName);
  if (
    selectedExterior &&
    !exteriors.some((row) => row.marketHashName === marketHashName)
  ) {
    exteriors.push({
      exterior: selectedExterior,
      marketHashName,
      price: priceResult.price ?? null,
      sellListings: listing.totalCount,
    });
    sortByExterior(exteriors);
  }

  const sameRarityList = Array.from(grouped.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  const lowerRarity = LOWER_RARITY_MAP[rarity];
  let lowerDetails: SkinDetails["lowerRarity"] = null;
  if (lowerRarity && collectionInternal) {
    const lowerItems = await fetchAllCollectionItems(
      collectionInternal,
      RARITY_TO_TAG[lowerRarity],
    );
    lowerDetails = {
      rarity: lowerRarity,
      items: buildLowerRarity(lowerItems),
    };
  }

  return {
    marketHashName,
    baseName,
    rarity,
    collection: collectionName,
    price: priceResult.price ?? null,
    sellListings: listing.totalCount,
    exteriors,
    sameRarity: sameRarityList,
    lowerRarity: lowerDetails,
  };
};
