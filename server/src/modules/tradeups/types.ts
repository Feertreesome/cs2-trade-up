import type { Exterior } from "../skins/service";

export interface CollectionTargetExterior {
  exterior: Exterior;
  marketHashName: string;
  price?: number | null;
  minFloat?: number;
  maxFloat?: number;
}

export interface CollectionTargetSummary {
  baseName: string;
  exteriors: CollectionTargetExterior[];
}

export const TARGET_RARITIES = [
  "Consumer",
  "Industrial",
  "Mil-Spec",
  "Restricted",
  "Classified",
  "Covert",
] as const;

export type TargetRarity = (typeof TARGET_RARITIES)[number];

export type InputRarity = Exclude<TargetRarity, "Covert">;

export interface CollectionTargetsResult {
  collectionTag: string;
  collectionId: string | null;
  rarity: TargetRarity;
  targets: CollectionTargetSummary[];
}

export interface CollectionInputSummary {
  baseName: string;
  marketHashName: string;
  exterior: Exterior;
  price?: number | null;
}

export interface CollectionInputsResult {
  collectionTag: string;
  collectionId: string | null;
  rarity: InputRarity | null;
  inputs: CollectionInputSummary[];
}

export interface SteamCollectionSummary {
  tag: string;
  name: string;
  count: number;
  collectionId: string | null;
}
