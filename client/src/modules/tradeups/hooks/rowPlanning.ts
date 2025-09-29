import type { Exterior } from "../../skins/services/types";
import type { CollectionInputSummary } from "../services/api";
import { EXTERIOR_FLOAT_RANGES, WEAR_BUCKET_SEQUENCE } from "./constants";
import {
  buildCollectionSelectValue,
  clampFloat,
  exteriorMidpoint,
  formatFloatValue,
  isFloatWithinExteriorRange,
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
  const target = options?.target;
  const targetBucketRange = target ? EXTERIOR_FLOAT_RANGES[target.exterior] : null;
  const rawMinOut = target?.minFloat != null ? clampFloat(target.minFloat) : null;
  const rawMaxOut = target?.maxFloat != null ? clampFloat(target.maxFloat) : null;
  const effectiveMinOut =
    rawMinOut ?? targetBucketRange?.min ?? targetRange?.min ?? null;
  const effectiveMaxOut =
    rawMaxOut ?? targetBucketRange?.max ?? targetRange?.max ?? null;
  const outputTarget =
    targetBucketRange?.max ?? rawMaxOut ?? effectiveMaxOut ?? null;

  let desiredFloat =
    outputTarget != null && effectiveMinOut != null && effectiveMaxOut != null
      ? effectiveMaxOut > effectiveMinOut
        ? clampFloat((outputTarget - effectiveMinOut) / (effectiveMaxOut - effectiveMinOut))
        : clampFloat(outputTarget)
      : null;

  if (desiredFloat == null) {
    desiredFloat = targetRange
      ? clampFloat((targetRange.min + targetRange.max) / 2)
      : desiredFloatFromTarget(options);
  }

  const sortedInputs = sortInputsForPlanning(inputs, desiredFloat);

  const inputsByExterior = sortedInputs.reduce((map, input) => {
    const current = map.get(input.exterior) ?? [];
    current.push(input);
    map.set(input.exterior, current);
    return map;
  }, new Map<Exterior, CollectionInputSummary[]>());

  const plannedInputs: CollectionInputSummary[] = [];

  if (desiredFloat != null) {
    const matchingCandidates: CollectionInputSummary[] = [];

    inputsByExterior.forEach((pool, exterior) => {
      if (!isFloatWithinExteriorRange(exterior, desiredFloat)) return;
      matchingCandidates.push(...pool);
    });

    if (matchingCandidates.length) {
      const [cheapestMatch] = sortInputsForPlanning(matchingCandidates, desiredFloat);
      if (cheapestMatch) {
        for (let i = 0; i < 10; i += 1) {
          plannedInputs.push(cheapestMatch);
        }
      }
    }
  }

  if (!plannedInputs.length && targetRange) {
    const projectedBuckets = WEAR_BUCKET_SEQUENCE.map((bucket) => {
      const bucketRange = EXTERIOR_FLOAT_RANGES[bucket.exterior];
      if (!bucketRange) return null;
      const min = Math.max(bucketRange.min, targetRange.min);
      const max = Math.min(bucketRange.max, targetRange.max);
      const width = Math.max(0, max - min);
      const containsPoint =
        targetRange.min === targetRange.max &&
        isFloatWithinExteriorRange(bucket.exterior, targetRange.min);
      const weight = width > 0 ? width : containsPoint ? 1e-6 : 0;
      if (weight <= 0) return null;
      return {
        exterior: bucket.exterior,
        weight,
      };
    }).filter((entry): entry is { exterior: Exterior; weight: number } => entry != null);

    if (projectedBuckets.length > 0) {
      const totalWeight = projectedBuckets.reduce((sum, entry) => sum + entry.weight, 0);
      const normalized = projectedBuckets.map((entry) => {
        const exact = (entry.weight / totalWeight) * 10;
        const count = Math.floor(exact);
        const remainder = exact - count;
        return { ...entry, count, remainder };
      });

      let assigned = normalized.reduce((sum, entry) => sum + entry.count, 0);
      const deficit = 10 - assigned;
      if (deficit > 0) {
        normalized
          .slice()
          .sort((a, b) => b.remainder - a.remainder)
          .slice(0, deficit)
          .forEach((entry) => {
            entry.count += 1;
          });
        assigned = normalized.reduce((sum, entry) => sum + entry.count, 0);
      }

      if (assigned > 10) {
        normalized
          .slice()
          .sort((a, b) => a.remainder - b.remainder)
          .slice(0, assigned - 10)
          .forEach((entry) => {
            if (entry.count > 0) {
              entry.count -= 1;
            }
          });
      }

      for (const entry of normalized) {
        if (entry.count <= 0) continue;
        const pool = inputsByExterior.get(entry.exterior);
        if (!pool || pool.length === 0) continue;
        for (let i = 0; i < entry.count; i += 1) {
          plannedInputs.push(pool[i % pool.length]);
        }
      }
    }
  }

  if (plannedInputs.length < 10) {
    for (let i = 0; plannedInputs.length < 10 && sortedInputs.length > 0; i += 1) {
      plannedInputs.push(sortedInputs[i % sortedInputs.length]);
    }
  }

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
