/** List of supported exterior values in predefined order. */
export const EXTERIORS = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
] as const;

/** Exterior type extracted from a market hash name. */
export type Exterior = typeof EXTERIORS[number];

/** Modes for expanding missing exteriors in the response. */
export type ExpandMode = "none" | "price" | "all";

/** Details about a particular exterior variant of a skin. */
export interface SkinExterior {
  exterior: Exterior;
  marketHashName: string;
  sell_listings: number;
  price: number | null;
}

/** Aggregated group of skins by base name and rarity. */
export interface SkinsGroup {
  baseName: string;
  rarity: string;
  exteriors: SkinExterior[];
}
