export type Exterior =
  | "Factory New"
  | "Minimal Wear"
  | "Field-Tested"
  | "Well-Worn"
  | "Battle-Scarred";

const EXTERIOR_PATTERN =
  / \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i;

export const parseMarketHashExterior = (marketHashName: string): Exterior => {
  const match = marketHashName.match(EXTERIOR_PATTERN);
  return (match?.[1] as Exterior) ?? "Field-Tested";
};

export const baseFromMarketHash = (marketHashName: string): string =>
  marketHashName.replace(EXTERIOR_PATTERN, "");
