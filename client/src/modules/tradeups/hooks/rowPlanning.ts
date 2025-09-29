import type { Exterior } from "../../skins/services/types";
import type { CollectionInputSummary } from "../services/api";
import { EXTERIOR_FLOAT_RANGES } from "./constants";
import {
  buildCollectionSelectValue,
  clampFloat,
  exteriorMidpoint,
  formatFloatValue,
  makeEmptyRow,
} from "./helpers";
import type { TradeupInputFormRow } from "./types";

interface PlanRowsOptions {
  target?: {
    exterior: Exterior;
    minFloat?: number | null;
    maxFloat?: number | null;
  };
}

interface PlanRowsParams {
  collectionTag: string;
  collectionId: string | null;
  selectedCollectionId: string | null;
  inputs: CollectionInputSummary[];
  options?: PlanRowsOptions;
}

interface PlannedRowsResult {
  rows: TradeupInputFormRow[];
  missingNames: string[];
}

const desiredFloatFromTarget = (options?: PlanRowsOptions) => {
  const target = options?.target;
  if (!target) return null;
  if (target.minFloat != null && target.maxFloat != null && target.maxFloat > target.minFloat) {
    return clampFloat((target.minFloat + target.maxFloat) / 2);
  }
  const midpoint = exteriorMidpoint(target.exterior);
  return midpoint != null ? clampFloat(midpoint) : null;
};

const resolveTargetRange = (options?: PlanRowsOptions) => {
  const target = options?.target;
  if (!target) return null;

  const bucket = EXTERIOR_FLOAT_RANGES[target.exterior];
  const clampToBounds = (value: number) => clampFloat(value);

  const resolveCatalogRange = () => {
    if (target.minFloat == null && target.maxFloat == null) return null;
    const min = target.minFloat != null ? clampToBounds(target.minFloat) : 0;
    const max = target.maxFloat != null ? clampToBounds(target.maxFloat) : 1;
    const normalizedMin = Math.min(min, max);
    const normalizedMax = Math.max(min, max);
    return { min: normalizedMin, max: normalizedMax };
  };

  if (bucket) {
    const bucketMin = clampToBounds(bucket.min);
    const bucketMax = clampToBounds(bucket.max);
    const catalogRange = resolveCatalogRange();
    const min = Math.max(bucketMin, catalogRange?.min ?? bucketMin);
    const max = Math.min(bucketMax, catalogRange?.max ?? bucketMax);
    if (min <= max) {
      return { min, max };
    }
    return { min: bucketMin, max: bucketMax };
  }

  return resolveCatalogRange();
};

const sortInputsForPlanning = (
  inputs: CollectionInputSummary[],
  desiredFloat: number | null,
): CollectionInputSummary[] => {
  const priceOf = (entry: CollectionInputSummary) =>
    typeof entry.price === "number" ? entry.price : Number.POSITIVE_INFINITY;

  const fallbackCompare = (a: CollectionInputSummary, b: CollectionInputSummary) => {
    if (desiredFloat != null) {
      const aMid = exteriorMidpoint(a.exterior) ?? desiredFloat;
      const bMid = exteriorMidpoint(b.exterior) ?? desiredFloat;
      const diff = Math.abs(aMid - desiredFloat) - Math.abs(bMid - desiredFloat);
      if (diff !== 0) return diff;
    }
    return a.marketHashName.localeCompare(b.marketHashName, "ru");
  };

  const sortableInputs = [...inputs];
  sortableInputs.sort((a, b) => {
    const priceDiff = priceOf(a) - priceOf(b);
    if (priceDiff !== 0) {
      return priceDiff;
    }
    return fallbackCompare(a, b);
  });
  return sortableInputs;
};

export const planRowsForCollection = ({
  collectionTag,
  collectionId,
  selectedCollectionId,
  inputs,
  options,
}: PlanRowsParams): PlannedRowsResult => {
  const effectiveCollectionValue = buildCollectionSelectValue(
    collectionId ?? selectedCollectionId,
    collectionTag,
  );

  const targetRange = resolveTargetRange(options);
  const desiredFloat = targetRange
    ? clampFloat((targetRange.min + targetRange.max) / 2)
    : desiredFloatFromTarget(options);

  const sortedInputs = sortInputsForPlanning(inputs, desiredFloat);

  const cheapestInput = sortedInputs[0] ?? null;
  const plannedInputs = cheapestInput ? Array.from({ length: 10 }, () => cheapestInput) : [];

  const trimmedPlan = plannedInputs.slice(0, 10);
  const offsetStep = desiredFloat != null && trimmedPlan.length > 1 ? 0.00005 : 0;
  const centerIndex = (trimmedPlan.length - 1) / 2;

  const rows: TradeupInputFormRow[] = trimmedPlan.map((input, index) => {
    const bucketRange = EXTERIOR_FLOAT_RANGES[input.exterior] ?? null;
    const rowFloatRange = (() => {
      if (!targetRange) {
        return bucketRange;
      }
      if (!bucketRange) {
        return targetRange;
      }
      const min = Math.max(bucketRange.min, targetRange.min);
      const max = Math.min(bucketRange.max, targetRange.max);
      if (min <= max) {
        return { min, max };
      }
      return bucketRange;
    })();

    const clampWithinRowRange = (value: number) => {
      const range = rowFloatRange ?? bucketRange ?? targetRange;
      if (range) {
        if (value < range.min) return clampFloat(range.min);
        if (value > range.max) return clampFloat(range.max);
        return clampFloat(value);
      }
      return clampFloat(value);
    };

    const rowMidpoint = rowFloatRange
      ? (rowFloatRange.min + rowFloatRange.max) / 2
      : bucketRange
      ? (bucketRange.min + bucketRange.max) / 2
      : null;
    const baselineSource = desiredFloat ?? rowMidpoint ?? exteriorMidpoint(input.exterior) ?? null;
    const baseline = baselineSource == null ? null : clampWithinRowRange(baselineSource);
    const adjusted =
      baseline == null
        ? null
        : clampWithinRowRange(baseline + offsetStep * (index - centerIndex));
    return {
      marketHashName: input.marketHashName,
      collectionId: effectiveCollectionValue,
      float: formatFloatValue(adjusted),
      buyerPrice: input.price != null ? input.price.toFixed(2) : "",
    };
  });

  while (rows.length < 10) rows.push(makeEmptyRow());

  const missingNames = trimmedPlan
    .filter((input) => input.price == null)
    .map((input) => input.marketHashName);

  return { rows, missingNames };
};
