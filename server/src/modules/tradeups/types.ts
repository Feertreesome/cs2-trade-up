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

export interface CollectionTargetsResult {
  collectionTag: string;
  collectionId: string | null;
  rarity: "Covert" | "Classified";
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
  rarity: "Classified" | "Restricted";
  inputs: CollectionInputSummary[];
}

export interface SteamCollectionSummary {
  tag: string;
  name: string;
  count: number;
  collectionId: string | null;
}
