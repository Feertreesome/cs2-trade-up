import type { Exterior } from "../../skins/services/types";
import { parseExterior } from "../../skins/services/utils";
import type { CollectionTargetSummary } from "../services/api";
import { EXTERIOR_FLOAT_RANGES, WEAR_BUCKET_SEQUENCE } from "./constants";
import { clampFloat, isFloatWithinExteriorRange } from "./helpers";
import type {
  FloatlessAnalysisResult,
  FloatlessOutcomeExterior,
  FloatlessOutcomeSummary,
  RowResolution,
  SelectedTarget,
} from "./types";

interface FloatlessAnalysisParams {
  rowResolution: RowResolution;
  activeTargets: CollectionTargetSummary[];
  selectedTarget: SelectedTarget | null;
  targetPriceOverrides: Record<string, number>;
  buyerToNetRate: number;
  totalNetCost: number;
}

type WearSlot = { exterior: Exterior; bucket: { min: number; max: number } };

export const evaluateFloatlessTradeup = ({
  rowResolution,
  activeTargets,
  selectedTarget,
  targetPriceOverrides,
  buyerToNetRate,
  totalNetCost,
}: FloatlessAnalysisParams): FloatlessAnalysisResult => {
  const issues: string[] = [];
  const wearCounts: Partial<Record<Exterior, number>> = {};

  if (!rowResolution.rows.length) {
    issues.push("Нужно добавить входы для оценки");
    return {
      ready: false,
      issues,
      inputRange: null,
      wearCounts,
      outcomes: [],
      robustOutcomeNet: null,
      expectedOutcomeNet: null,
      robustEV: null,
      expectedEV: null,
      expectedCoverage: 0,
    };
  }

  if (rowResolution.rows.length !== 10) {
    issues.push("Нужно ровно 10 входов для trade-up");
  }

  if (rowResolution.unresolvedNames.length) {
    issues.push(
      `Не удалось определить коллекцию для: ${rowResolution.unresolvedNames
        .map((name) => `"${name}"`)
        .join(", ")}`,
    );
  }

  if (rowResolution.hasMultipleCollections) {
    issues.push("Нужно использовать предметы из одной коллекции");
  }

  const resolvedCollectionId = rowResolution.resolvedCollectionId;
  if (!resolvedCollectionId) {
    issues.push("Не выбрана целевая коллекция для расчёта");
  }

  if (!activeTargets.length) {
    issues.push("Нет данных о выходах для выбранной коллекции");
  }

  const wearSlots = rowResolution.rows.map<WearSlot | null>((row) => {
    const exterior = parseExterior(row.marketHashName);
    const bucket = EXTERIOR_FLOAT_RANGES[exterior];
    if (!bucket) return null;
    wearCounts[exterior] = (wearCounts[exterior] ?? 0) + 1;
    return { exterior, bucket };
  });

  if (wearSlots.some((slot) => slot == null)) {
    issues.push("Не удалось распознать wear некоторых входов по market_hash_name");
  }

  if (issues.length > 0 || !resolvedCollectionId) {
    return {
      ready: false,
      issues,
      inputRange: null,
      wearCounts,
      outcomes: [],
      robustOutcomeNet: null,
      expectedOutcomeNet: null,
      robustEV: null,
      expectedEV: null,
      expectedCoverage: 0,
    };
  }

  const validSlots = wearSlots.filter((slot): slot is WearSlot => Boolean(slot));
  const totalSlots = validSlots.length;
  const minSum = validSlots.reduce((sum, slot) => sum + slot.bucket.min, 0);
  const maxSum = validSlots.reduce((sum, slot) => sum + slot.bucket.max, 0);
  const inputRange = {
    min: clampFloat(minSum / Math.max(totalSlots, 1)),
    max: clampFloat(maxSum / Math.max(totalSlots, 1)),
  };

  const collectionProbability = rowResolution.rows.length
    ? (rowResolution.collectionCounts.get(resolvedCollectionId) ?? 0) / rowResolution.rows.length
    : 0;

  const baseCount = activeTargets.length;
  const baseProbability = baseCount > 0 ? collectionProbability / baseCount : 0;

  const outcomes: FloatlessOutcomeSummary[] = [];
  let robustOutcomeNet: number | null = 0;
  let expectedOutcomeNet: number | null = 0;
  let expectedCoverage = 0;

  let selectedTargetCoverage: {
    probability: number | null;
    projectedRange: { min: number; max: number };
    dominantExterior: Exterior | null;
  } | null = null;

  for (const target of activeTargets) {
    const exteriorEntries = target.exteriors;
    let minFloat: number | null = null;
    let maxFloat: number | null = null;
    for (const exterior of exteriorEntries) {
      if (exterior.minFloat != null) {
        minFloat = minFloat == null ? exterior.minFloat : Math.min(minFloat, exterior.minFloat);
      }
      if (exterior.maxFloat != null) {
        maxFloat = maxFloat == null ? exterior.maxFloat : Math.max(maxFloat, exterior.maxFloat);
      }
    }

    if (minFloat == null || maxFloat == null) {
      minFloat = 0;
      maxFloat = 1;
    }

    if (minFloat > maxFloat) {
      [minFloat, maxFloat] = [maxFloat, minFloat];
    }

    const projectedMin = clampFloat(minFloat + (maxFloat - minFloat) * inputRange.min);
    const projectedMax = clampFloat(minFloat + (maxFloat - minFloat) * inputRange.max);
    const normalizedMin = Math.min(projectedMin, projectedMax);
    const normalizedMax = Math.max(projectedMin, projectedMax);
    const rangeWidth = Math.max(0, normalizedMax - normalizedMin);

    const potential = WEAR_BUCKET_SEQUENCE.map((bucket) => {
      const targetExterior = exteriorEntries.find((entry) => entry.exterior === bucket.exterior);
      if (!targetExterior) return null;
      const matchesSelected =
        !!selectedTarget &&
        target.baseName === selectedTarget.baseName &&
        (targetExterior.marketHashName === selectedTarget.marketHashName ||
          targetExterior.exterior === selectedTarget.exterior);
      const min = Math.max(bucket.min, normalizedMin);
      const max = Math.min(bucket.max, normalizedMax);
      const width = Math.max(0, max - min);
      const containsPoint =
        rangeWidth === 0 && isFloatWithinExteriorRange(bucket.exterior, normalizedMin);
      if (width <= 0 && !containsPoint && !matchesSelected) return null;
      const buyerPrice = targetPriceOverrides[targetExterior.marketHashName] ?? targetExterior.price ?? null;
      const netPrice = buyerPrice == null ? null : buyerPrice / buyerToNetRate;
      const probability = baseProbability > 0 ? width / (maxFloat - minFloat || 1) : null;
      const outcome: FloatlessOutcomeExterior = {
        exterior: bucket.exterior,
        probability,
        buyerPrice,
        netPrice,
        marketHashName: targetExterior.marketHashName,
      };
      if (matchesSelected) {
        selectedTargetCoverage = {
          probability,
          projectedRange: { min: normalizedMin, max: normalizedMax },
          dominantExterior: bucket.exterior,
        };
      }
      if (probability != null) {
        expectedCoverage += probability;
      }
      return outcome;
    }).filter((entry): entry is FloatlessOutcomeExterior => Boolean(entry));

    if (!potential.length) continue;

    const dominantExterior = potential.reduce<Exterior | null>((prev, current) => {
      if (current.probability == null) return prev;
      if (!prev) return current.exterior;
      const prevProbability = potential.find((entry) => entry.exterior === prev)?.probability ?? 0;
      return prevProbability >= current.probability! ? prev : current.exterior;
    }, null);

    const projectedRange = { min: normalizedMin, max: normalizedMax };
    const expectedProbability = potential.reduce((sum, entry) => sum + (entry.probability ?? 0), 0);
    const expectedNetContribution = potential.reduce((sum, entry) => {
      if (entry.netPrice == null || entry.probability == null) return sum;
      return sum + entry.netPrice * entry.probability;
    }, 0);
    const robustNet = potential.reduce((sum, entry) => {
      if (entry.netPrice == null) {
        return sum;
      }
      return Math.min(sum, entry.netPrice);
    }, Number.POSITIVE_INFINITY);

    const outcomeSummary: FloatlessOutcomeSummary = {
      baseName: target.baseName,
      probability: baseProbability,
      projectedRange,
      exteriors: potential,
      robustNet: Number.isFinite(robustNet) ? robustNet : null,
      expectedNetContribution: expectedNetContribution || null,
      expectedProbabilityCovered: expectedProbability,
    };

    outcomes.push(outcomeSummary);

    if (outcomeSummary.robustNet != null) {
      if (robustOutcomeNet == null) {
        robustOutcomeNet = outcomeSummary.robustNet;
      } else {
        robustOutcomeNet += outcomeSummary.robustNet;
      }
    }

    if (outcomeSummary.expectedNetContribution != null) {
      if (expectedOutcomeNet == null) {
        expectedOutcomeNet = outcomeSummary.expectedNetContribution;
      } else {
        expectedOutcomeNet += outcomeSummary.expectedNetContribution;
      }
    }

    if (selectedTarget && selectedTarget.baseName === target.baseName && selectedTargetCoverage) {
      selectedTargetCoverage = {
        ...selectedTargetCoverage,
        dominantExterior,
      };
    }
  }

  const robustEV =
    robustOutcomeNet == null || totalNetCost == null
      ? null
      : clampFloat(robustOutcomeNet - totalNetCost);
  const expectedEV =
    expectedOutcomeNet == null || totalNetCost == null
      ? null
      : clampFloat(expectedOutcomeNet - totalNetCost);

  return {
    ready: issues.length === 0,
    issues,
    inputRange,
    wearCounts,
    outcomes,
    robustOutcomeNet,
    expectedOutcomeNet,
    robustEV,
    expectedEV,
    expectedCoverage,
  };
};
