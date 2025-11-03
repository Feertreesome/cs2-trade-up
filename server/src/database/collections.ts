import { prisma } from "./client";
import type {
  CollectionTargetsResult,
  CollectionTargetSummary,
  CollectionTargetExterior,
  CollectionInputsResult,
  CollectionInputSummary,
  SteamCollectionSummary,
  TargetRarity,
  InputRarity,
} from "../modules/tradeups/types";
import { TARGET_RARITIES } from "../modules/tradeups/types";
import { baseFromMarketHash } from "../modules/skins/service";

const normalizeRarity = (rarity: string) => rarity.trim();

type SelectedSkin = {
  marketHashName: string;
  baseName: string;
  exterior: string;
  lastKnownPrice: number | null;
  rarity: string;
  isSouvenir: boolean;
  isStatTrak: boolean;
  floatMin: number | null;
  floatMax: number | null;
};

type SkinSummary = {
  marketHashName: string;
  sellListings: number;
  lastKnownPrice: number | null;
};

const defaultSkinSelect = {
  marketHashName: true,
  baseName: true,
  exterior: true,
  lastKnownPrice: true,
  rarity: true,
  isSouvenir: true,
  isStatTrak: true,
  floatMin: true,
  floatMax: true,
};

const normalFilter = (normalOnly: boolean) =>
  normalOnly
    ? { isSouvenir: false, isStatTrak: false }
    : {};

export const getCollectionSummariesFromDb = async (): Promise<SteamCollectionSummary[] | null> => {
  try {
    const collections = await prisma.collection.findMany({
      orderBy: { name: "asc" },
    });
    if (!collections.length) return null;
    return collections.map((collection: (typeof collections)[number]) => ({
      tag: collection.steamTag,
      name: collection.name,
      count: collection.normalItemCount || collection.totalItems,
      collectionId: collection.localCollectionId ?? null,
    }));
  } catch (error) {
    return null;
  }
};

const buildTargets = (
  entries: Array<{
    baseName: string;
    marketHashName: string;
    exterior: string;
    lastKnownPrice: number | null;
    floatMin?: number | null;
    floatMax?: number | null;
  }>,
): CollectionTargetSummary[] => {
  const grouped = new Map<string, CollectionTargetSummary>();
  for (const entry of entries) {
    const baseName = entry.baseName || baseFromMarketHash(entry.marketHashName);
    const summary = grouped.get(baseName) ?? {
      baseName,
      exteriors: [],
    };
    summary.exteriors.push({
      exterior: entry.exterior as CollectionTargetExterior["exterior"],
      marketHashName: entry.marketHashName,
      price: entry.lastKnownPrice,
      minFloat: entry.floatMin ?? undefined,
      maxFloat: entry.floatMax ?? undefined,
    });
    grouped.set(baseName, summary);
  }
  return Array.from(grouped.values()).sort((a, b) => a.baseName.localeCompare(b.baseName));
};

export const getCollectionTargetsFromDb = async (
  collectionTag: string,
  rarity: TargetRarity,
): Promise<CollectionTargetsResult | null> => {
  try {
    const collection = await prisma.collection.findUnique({
      where: { steamTag: collectionTag },
      select: {
        id: true,
        localCollectionId: true,
        steamTag: true,
        skins: {
          where: {
            rarity,
            isSouvenir: false,
            isStatTrak: false,
          },
          orderBy: { marketHashName: "asc" },
          select: defaultSkinSelect,
        },
      },
    });

    if (!collection) return null;

    const skins = collection.skins as SelectedSkin[];
    const targets: CollectionTargetSummary[] = buildTargets(
      skins.map((skin: SelectedSkin) => ({
        baseName: skin.baseName,
        marketHashName: skin.marketHashName,
        exterior: skin.exterior,
        lastKnownPrice: skin.lastKnownPrice,
        floatMin: skin.floatMin,
        floatMax: skin.floatMax,
      })),
    );

    return {
      collectionTag,
      collectionId: collection.localCollectionId ?? null,
      rarity,
      targets,
    };
  } catch (error) {
    return null;
  }
};

export const getCollectionRaritiesFromDb = async (
  collectionTag: string,
): Promise<TargetRarity[]> => {
  try {
    const result = await prisma.skin.groupBy({
      by: ["rarity"],
      where: {
        collection: { steamTag: collectionTag },
        isSouvenir: false,
        isStatTrak: false,
      },
    });
    if (!result.length) return [];

    const allowed = new Set(TARGET_RARITIES);
    const rarities: TargetRarity[] = [];
    for (const entry of result) {
      const value = String(entry.rarity ?? "").trim();
      if (!value) continue;
      if (allowed.has(value as TargetRarity)) {
        rarities.push(value as TargetRarity);
      }
    }
    return rarities;
  } catch (error) {
    return [];
  }
};

export const getCollectionInputsFromDb = async (
  collectionTag: string,
  inputRarity: InputRarity,
): Promise<CollectionInputsResult | null> => {
  try {
    const collection = await prisma.collection.findUnique({
      where: { steamTag: collectionTag },
      select: {
        id: true,
        localCollectionId: true,
        skins: {
          where: {
            rarity: inputRarity,
            isSouvenir: false,
            isStatTrak: false,
          },
          orderBy: { marketHashName: "asc" },
          select: defaultSkinSelect,
        },
      },
    });
    if (!collection) return null;

    const skins = collection.skins as SelectedSkin[];
    const inputs: CollectionInputSummary[] = skins.map((skin: SelectedSkin) => ({
      baseName: skin.baseName,
      marketHashName: skin.marketHashName,
      exterior: skin.exterior as CollectionInputSummary["exterior"],
      price: skin.lastKnownPrice,
    }));

    return {
      collectionTag,
      collectionId: collection.localCollectionId ?? null,
      rarity: inputRarity,
      inputs,
    };
  } catch (error) {
    return null;
  }
};

export const getRarityTotalsFromDb = async (
  rarities: string[],
  normalOnly: boolean,
): Promise<{ perRarity: Record<string, number>; sum: number } | null> => {
  try {
    const result = await prisma.skin.groupBy({
      by: ["rarity"],
      where: {
        rarity: { in: rarities.map(normalizeRarity) },
        ...normalFilter(normalOnly),
      },
      _count: { _all: true },
    });
    if (!result.length) return null;

    const perRarity: Record<string, number> = {};
    let sum = 0;
    for (const entry of result) {
      const rarity = entry.rarity;
      const count = entry._count._all;
      perRarity[rarity] = count;
      sum += count;
    }
    return { perRarity, sum };
  } catch (error) {
    return null;
  }
};

export const getSkinsPageFromDb = async (
  rarity: string,
  start: number,
  count: number,
  normalOnly: boolean,
): Promise<{ total: number; items: Array<{ market_hash_name: string; sell_listings: number; price: number | null }> } | null> => {
  try {
    const where = {
      rarity: normalizeRarity(rarity),
      ...normalFilter(normalOnly),
    };
    const [total, skins] = await prisma.$transaction([
      prisma.skin.count({ where }),
      prisma.skin.findMany({
        where,
        orderBy: { marketHashName: "asc" },
        skip: start,
        take: count,
        select: {
          marketHashName: true,
          sellListings: true,
          lastKnownPrice: true,
        },
      }),
    ]);

    const summaryRows = skins as SkinSummary[];
    const items = summaryRows.map((skin: SkinSummary) => ({
      market_hash_name: skin.marketHashName,
      sell_listings: skin.sellListings,
      price: skin.lastKnownPrice ?? null,
    }));

    return { total, items };
  } catch (error) {
    return null;
  }
};

export const getNamesByRarityFromDb = async (
  rarity: string,
  normalOnly: boolean,
): Promise<string[] | null> => {
  try {
    const skins = await prisma.skin.findMany({
      where: {
        rarity: normalizeRarity(rarity),
        ...normalFilter(normalOnly),
      },
      orderBy: { marketHashName: "asc" },
      select: { marketHashName: true },
    });
    if (!skins.length) return [];
    return skins.map((skin: { marketHashName: string }) => skin.marketHashName);
  } catch (error) {
    return null;
  }
};
