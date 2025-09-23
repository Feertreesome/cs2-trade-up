export const EXTERIORS = ["Factory New","Minimal Wear","Field-Tested","Well-Worn","Battle-Scarred"] as const;
export const RARITIES  = ["Mil-Spec","Restricted","Classified","Covert"] as const;

export type Exterior   = typeof EXTERIORS[number];
export type Rarity     = typeof RARITIES[number];
export type ExpandMode = "none" | "price" | "all";

export type FlatItem = { market_hash_name: string; sell_listings: number; rarity: Rarity; price?: number | null };

export type AggGroup = {
  baseName: string;
  rarity: Rarity;
  exteriors: { exterior: Exterior; marketHashName: string; sell_listings: number; price: number | null }[];
};

export type ApiFlatResp = { rarities: Rarity[]; total: number; items: FlatItem[]; meta?: any };
export type ApiAggResp  = { rarities: Rarity[]; total: number; skins: AggGroup[]; meta?: any };

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

