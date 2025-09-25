import type { Exterior } from "../../skins/services/types";

export const EXTERIOR_FLOAT_RANGES: Record<Exterior, { min: number; max: number }> = {
  "Factory New": { min: 0, max: 0.07 },
  "Minimal Wear": { min: 0.07, max: 0.15 },
  "Field-Tested": { min: 0.15, max: 0.38 },
  "Well-Worn": { min: 0.38, max: 0.45 },
  "Battle-Scarred": { min: 0.45, max: 1 },
};

export const WEAR_BUCKET_SEQUENCE: Array<{ exterior: Exterior; min: number; max: number }> = [
  { exterior: "Factory New", min: 0, max: 0.07 },
  { exterior: "Minimal Wear", min: 0.07, max: 0.15 },
  { exterior: "Field-Tested", min: 0.15, max: 0.38 },
  { exterior: "Well-Worn", min: 0.38, max: 0.45 },
  { exterior: "Battle-Scarred", min: 0.45, max: 1 },
];

export const STEAM_TAG_VALUE_PREFIX = "steam-tag:";
