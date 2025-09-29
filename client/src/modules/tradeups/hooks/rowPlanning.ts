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

const normalizeRange = (range: { min: number; max: number }) => {
  const min = clampFloat(Math.min(range.min, range.max));
  const max = clampFloat(Math.max(range.min, range.max));
  return { min, max };
};

const computeRequiredAverageFloat = (
  targetRange: { min: number; max: number } | null,
  desiredFloat: number | null,
) => {
  if (desiredFloat == null) return null;
  if (!targetRange) {
    return clampFloat(desiredFloat);
  }
  const span = targetRange.max - targetRange.min;
  if (span > 0) {
    return clampFloat((desiredFloat - targetRange.min) / span);
  }
  return clampFloat(targetRange.min);
};

const projectAverageOntoRanges = (
  ranges: Array<{ min: number; max: number }>,
  targetAverage: number | null,
) => {
  if (!ranges.length) return [];
  const normalized = ranges.map(normalizeRange);
  if (targetAverage == null) {
    return normalized.map((range) => (range.min + range.max) / 2);
  }

  const clampedAverage = clampFloat(targetAverage);
  const totalSlots = normalized.length;
  const minSum = normalized.reduce((sum, range) => sum + range.min, 0);
  const maxSum = normalized.reduce((sum, range) => sum + range.max, 0);
  const desiredSum = Math.min(Math.max(clampedAverage * totalSlots, minSum), maxSum);

  const epsilon = 1e-9;
  const values = normalized.map((range) =>
    clampFloat(Math.min(range.max, Math.max(range.min, clampedAverage))),
  );

  const distribute = (
    capacities: number[],
    remaining: number,
    adjust: (index: number, delta: number) => void,
  ) => {
    let available = capacities
      .map((capacity, index) => ({ index, capacity }))
      .filter((entry) => entry.capacity > epsilon);

    while (remaining > epsilon && available.length > 0) {
      const share = remaining / available.length;
      let consumed = 0;

      const nextAvailable: Array<{ index: number; capacity: number }> = [];

      for (const entry of available) {
        const delta = Math.min(share, entry.capacity);
        if (delta > epsilon) {
          adjust(entry.index, delta);
          consumed += delta;
          const residual = entry.capacity - delta;
          if (residual > epsilon) {
            nextAvailable.push({ index: entry.index, capacity: residual });
          }
        }
      }

      if (consumed <= epsilon) {
        break;
      }
      remaining -= consumed;
      available = nextAvailable;
    }
    return remaining;
  };

  const currentSum = values.reduce((sum, value) => sum + value, 0);

  if (currentSum < desiredSum - epsilon) {
    const capacities = values.map((value, index) => normalized[index].max - value);
    let remaining = desiredSum - currentSum;
    remaining = distribute(capacities, remaining, (index, delta) => {
      values[index] += delta;
    });

    if (remaining > epsilon) {
      for (let index = 0; index < values.length && remaining > epsilon; index += 1) {
        const room = normalized[index].max - values[index];
        if (room <= epsilon) continue;
        const delta = Math.min(room, remaining);
        values[index] += delta;
        remaining -= delta;
      }
    }
  } else if (currentSum > desiredSum + epsilon) {
    const capacities = values.map((value, index) => value - normalized[index].min);
    let remaining = currentSum - desiredSum;
    remaining = distribute(capacities, remaining, (index, delta) => {
      values[index] -= delta;
    });

    if (remaining > epsilon) {
      for (let index = 0; index < values.length && remaining > epsilon; index += 1) {
        const room = values[index] - normalized[index].min;
        if (room <= epsilon) continue;
        const delta = Math.min(room, remaining);
        values[index] -= delta;
        remaining -= delta;
      }
    }
  }

  return values.map((value, index) =>
    clampFloat(Math.min(normalized[index].max, Math.max(normalized[index].min, value))),
  );
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

  const plannedInputs: CollectionInputSummary[] = [];
  for (let i = 0; plannedInputs.length < 10 && sortedInputs.length > 0; i += 1) {
    plannedInputs.push(sortedInputs[i % sortedInputs.length]);
  }

  const trimmedPlan = plannedInputs.slice(0, 10);

  const requiredAverageFloat = computeRequiredAverageFloat(targetRange, desiredFloat);
  const resolvedRanges = trimmedPlan.map((input) => {
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

    const effectiveRange = rowFloatRange ?? bucketRange ?? targetRange ?? { min: 0, max: 1 };
    return {
      bucketRange,
      rowFloatRange,
      effectiveRange: normalizeRange(effectiveRange),
    };
  });

  const assignedFloats = projectAverageOntoRanges(
    resolvedRanges.map((entry) => entry.effectiveRange),
    requiredAverageFloat,
  );

  const rows: TradeupInputFormRow[] = trimmedPlan.map((input, index) => {
    const { bucketRange, rowFloatRange } = resolvedRanges[index];

    const clampWithinRowRange = (value: number) => {
      const range = rowFloatRange ?? bucketRange ?? targetRange;
      if (range) {
        if (value < range.min) return clampFloat(range.min);
        if (value > range.max) return clampFloat(range.max);
        return clampFloat(value);
      }
      return clampFloat(value);
    };

    const assigned = assignedFloats[index] ?? null;
    const fallbackMidpoint = rowFloatRange
      ? (rowFloatRange.min + rowFloatRange.max) / 2
      : bucketRange
      ? (bucketRange.min + bucketRange.max) / 2
      : exteriorMidpoint(input.exterior) ?? null;
    const resolvedFloat = assigned ?? fallbackMidpoint;

    return {
      marketHashName: input.marketHashName,
      collectionId: effectiveCollectionValue,
      float: formatFloatValue(resolvedFloat == null ? null : clampWithinRowRange(resolvedFloat)),
      buyerPrice: input.price != null ? input.price.toFixed(2) : "",
    };
  });

  while (rows.length < 10) rows.push(makeEmptyRow());

  const missingNames = trimmedPlan
    .filter((input) => input.price == null)
    .map((input) => input.marketHashName);

  return { rows, missingNames };
};
