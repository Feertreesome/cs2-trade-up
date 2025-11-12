export const EXTERIORS = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
] as const;

export type Exterior = (typeof EXTERIORS)[number];

export interface TradeupInputFormRow {
  marketHashName: string;
  collectionId: string;
  float: string;
  price: string;
}
