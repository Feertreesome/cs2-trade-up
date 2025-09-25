import type { Exterior } from "../../skins/services/types";
import { EXTERIOR_FLOAT_RANGES, STEAM_TAG_VALUE_PREFIX } from "./constants";
import type { TradeupInputFormRow } from "./types";

export const makeEmptyRow = (): TradeupInputFormRow => ({
  marketHashName: "",
  collectionId: "",
  float: "",
  buyerPrice: "",
});

export const createInitialRows = () => Array.from({ length: 10 }, makeEmptyRow);

export const clampFloat = (value: number) => Math.min(1, Math.max(0, value));

export const exteriorMidpoint = (exterior: Exterior) => {
  const range = EXTERIOR_FLOAT_RANGES[exterior];
  if (!range) return null;
  return (range.min + range.max) / 2;
};

export const formatFloatValue = (value: number | null | undefined) =>
  value == null ? "" : clampFloat(value).toFixed(5);

export const buildCollectionSelectValue = (
  collectionId?: string | null,
  collectionTag?: string | null,
) => {
  if (collectionId) return collectionId;
  if (collectionTag) return `${STEAM_TAG_VALUE_PREFIX}${collectionTag}`;
  return "";
};

export const readTagFromCollectionValue = (value: string) =>
  value.startsWith(STEAM_TAG_VALUE_PREFIX)
    ? value.slice(STEAM_TAG_VALUE_PREFIX.length)
    : null;
