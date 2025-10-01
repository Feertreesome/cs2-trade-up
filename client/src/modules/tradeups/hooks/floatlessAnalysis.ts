import type { Exterior } from "../../skins/services/types";
import { parseExterior } from "../../skins/services/utils";
import type { CollectionTargetSummary, TargetRarity, TradeupCollection } from "../services/api";
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
  catalogMap: Map<string, TradeupCollection>;
  selectedTarget: SelectedTarget | null;
  targetPriceOverrides: Record<string, number>;
  buyerToNetRate: number;
  totalNetCost: number;
  targetRarity: TargetRarity;
}

type WearSlot = { exterior: Exterior; bucket: { min: number; max: number } };

export const evaluateFloatlessTradeup = ({
  rowResolution,
  activeTargets,
  catalogMap,
  selectedTarget,
  targetPriceOverrides,
  buyerToNetRate,
  totalNetCost,
  targetRarity,
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

  const catalogEntry = catalogMap.get(resolvedCollectionId) ?? null;

  const outcomes: FloatlessOutcomeSummary[] = [];
  let robustOutcomeNet: number | null = 0;
  let expectedOutcomeNet: number | null = 0;
  let expectedCoverage = 0;
  let hasRobustGap = false;
  let hasExpectedData = false;

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
      const fallbackList =
        targetRarity === "Classified" ? catalogEntry?.classified : catalogEntry?.covert;
      const fallback = fallbackList?.find((entry) => entry.baseName === target.baseName);
      if (fallback) {
        minFloat = fallback.minFloat;
        maxFloat = fallback.maxFloat;
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
      const buyerPrice =
        targetExterior.price ?? targetPriceOverrides[targetExterior.marketHashName] ?? null;
      const netPrice = buyerPrice == null ? null : buyerPrice / buyerToNetRate;
      return {
        exterior: bucket.exterior,
        width,
        containsPoint,
        matchesSelected,
        buyerPrice,
        netPrice,
        marketHashName: targetExterior.marketHashName,
      };
    }).filter((entry): entry is {
      exterior: Exterior;
      width: number;
      containsPoint: boolean;
      matchesSelected: boolean;
      buyerPrice: number | null;
      netPrice: number | null;
      marketHashName: string;
    } => entry != null);

    let widthSum = 0;
    for (const entry of potential) {
      widthSum += entry.width;
    }

    const denominator = rangeWidth > 0 ? widthSum || rangeWidth : 1;
    const exteriors: FloatlessOutcomeExterior[] = [];
    let robustNet: number | null = null;
    let expectedContribution: number | null = null;
    let expectedProbabilityCovered = 0;
    let selectedProbability: number | null = null;
    let dominantExterior: { exterior: Exterior; probability: number } | null = null;

    for (const entry of potential) {
      let probability: number | null = null;
      if (rangeWidth === 0) {
        probability = entry.containsPoint ? 1 : 0;
      } else if (denominator > 0) {
        probability = entry.width / denominator;
      }

      exteriors.push({
        exterior: entry.exterior,
        probability,
        buyerPrice: entry.buyerPrice,
        netPrice: entry.netPrice,
        marketHashName: entry.marketHashName,
      });

      if (probability != null && entry.netPrice != null) {
        if (robustNet == null || entry.netPrice < robustNet) {
          robustNet = entry.netPrice;
        }
        expectedContribution = (expectedContribution ?? 0) + entry.netPrice * probability;
        expectedProbabilityCovered += probability;
      }

      if (probability != null) {
        if (
          dominantExterior == null ||
          probability > dominantExterior.probability ||
          (probability === dominantExterior.probability && entry.exterior === selectedTarget?.exterior)
        ) {
          dominantExterior = { exterior: entry.exterior, probability };
        }

        if (
          entry.matchesSelected &&
          target.baseName === selectedTarget?.baseName &&
          (selectedProbability == null || probability > selectedProbability)
        ) {
          selectedProbability = probability;
        }
      }
    }

    if (robustNet == null) {
      hasRobustGap = true;
    }

    if (expectedContribution != null && expectedProbabilityCovered > 0) {
      hasExpectedData = true;
      expectedOutcomeNet = (expectedOutcomeNet ?? 0) + expectedContribution * baseProbability;
      expectedCoverage += expectedProbabilityCovered * baseProbability;
    }

    if (robustNet != null) {
      robustOutcomeNet = (robustOutcomeNet ?? 0) + robustNet * baseProbability;
    }

    outcomes.push({
      baseName: target.baseName,
      probability: baseProbability,
      projectedRange: { min: normalizedMin, max: normalizedMax },
      exteriors,
      robustNet,
      expectedNetContribution: expectedContribution,
      expectedProbabilityCovered,
    });

    if (selectedTarget && target.baseName === selectedTarget.baseName) {
      selectedTargetCoverage = {
        probability: selectedProbability,
        projectedRange: { min: normalizedMin, max: normalizedMax },
        dominantExterior: dominantExterior?.exterior ?? null,
      };
    }
  }

  if (hasRobustGap) {
    robustOutcomeNet = null;
  }

  if (!hasExpectedData) {
    expectedOutcomeNet = null;
    expectedCoverage = 0;
  }

  const robustEV = robustOutcomeNet == null ? null : robustOutcomeNet - totalNetCost;
  const expectedEV = expectedOutcomeNet == null ? null : expectedOutcomeNet - totalNetCost;

  if (
    selectedTarget &&
    selectedTargetCoverage &&
    (selectedTargetCoverage.probability == null || selectedTargetCoverage.probability <= 0)
  ) {
    const fallbackExteriorLabel = selectedTargetCoverage.dominantExterior
      ? `${selectedTargetCoverage.dominantExterior}`
      : "другой экстерьер";
    issues.push(
      `Выбранный экстерьер ${selectedTarget.exterior} (${selectedTarget.baseName}) ` +
        `не попадает в прогнозируемый диапазон (${selectedTargetCoverage.projectedRange.min.toFixed(5)}–${selectedTargetCoverage.projectedRange.max.toFixed(5)}). ` +
        `Ожидаемый результат: ${fallbackExteriorLabel}.`,
    );
  }

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
