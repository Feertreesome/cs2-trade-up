const EXTERIOR_SHORT: Record<string, string> = {
  "Factory New": "FN",
  "Minimal Wear": "MW",
  "Field-Tested": "FT",
  "Well-Worn": "WW",
  "Battle-Scarred": "BS",
};

export const WEAR_ORDER = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
] as const;

export const shortExterior = (exterior: string) => EXTERIOR_SHORT[exterior] ?? exterior;
