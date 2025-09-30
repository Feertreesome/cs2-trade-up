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

type Range = { min: number; max: number };

// почти-равенство
const almostEqual = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

export function isFloatWithinExteriorRange(
  exterior: Exterior,
  value: number,
  tolerance = 1e-6, // разумный tol, но применяем АСИММЕТРИЧНО
) {
  const range: Range | undefined = EXTERIOR_FLOAT_RANGES[exterior];
  if (!range) return false;

  // ===== НИЖНЯЯ ГРАНИЦА =====
  // Для НУЛЕВОГО минимума (например, FN: min=0):
  // разрешаем «микро-отрицательные» значения как 0 (из-за округления),
  // но для min > 0 никакого допуска — иначе диапазоны перекрываются.
  if (value < range.min) {
    if (range.min === 0 && almostEqual(value, range.min, tolerance)) {
      // Ок, считаем как min
    } else {
      return false;
    }
  }

  const isLastBucket = exterior === 'Battle-Scarred';

  // ===== ВЕРХНЯЯ ГРАНИЦА =====
  // Для ПОСЛЕДНЕГО бакета верх включительно (с допуском),
  // для остальных — строго < max (НИКАКОГО допуска).
  if (isLastBucket) {
    return value < range.max || almostEqual(value, range.max, tolerance);
  } else {
    return value < range.max;
  }
}

// export const isFloatWithinExteriorRange = (
//   exterior: Exterior,
//   value: number,
//   tolerance = Number.EPSILON,
// ) => {
//   console.log('=============================================');
//   const range = EXTERIOR_FLOAT_RANGES[exterior];
//   console.log(range, 'range isFloatWithinExteriorRange');
//   if (!range) return false;
//
//   console.log(value, 'desiredFloat value');
//   console.log(value >= range.min, 'value >= range.min');
//   console.log(Math.abs(value - range.min) <= tolerance, 'Math.abs(value - range.min) <= tolerance');
//   console.log(tolerance, 'tolerance');
//
//   console.log(value - range.min, 'value - range.min!!!!!!!!!!!!!!!');
//   // const aboveMin = value >= range.min || Math.abs(value - range.min) <= tolerance;
//   const aboveMin = value >= range.min || Math.abs(value - range.min) <= tolerance;
//   console.log(aboveMin, 'aboveMin isFloatWithinExteriorRange');
//   if (!aboveMin) {
//     console.log('111111111');
//     return false;
//   }
//
//   const isLastBucket = exterior === "Battle-Scarred";
//   if (isLastBucket) {
//     console.log('2222222222');
//     return value <= range.max || Math.abs(value - range.max) <= tolerance;
//   }
//
//   console.log(value < range.max, 'value < range.max');
//   if (value < range.max) {
//     console.log('3333333333');
//     return true;
//   }
//
//   console.log(value - range.max, 'value - range.max');
//   console.log(Math.abs(value - range.max) <= tolerance, 'Math.abs(value - range.max) <= tolerance');
// if (Math.abs(value - range.max) <= tolerance) {
//   console.log('444444444444');
//   return false;
// }
//
//   console.log('----------------------------------------------------');
//   return value < range.max;
// };

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
