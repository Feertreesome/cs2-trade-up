import React from "react";
import {
  fetchCollectionTargets,
  fetchCollectionInputs,
  fetchCollectionRarities,
  requestTradeupCalculation,
  type CollectionTargetsResponse,
  type CollectionInputSummary,
  type TargetRarity,
  type TradeupInputPayload,
  type TradeupOutcomeResponse,
  type SteamCollectionSummary,
} from "../tradeups/services/api";
import { planRowsForCollection } from "../tradeups/hooks/rowPlanning";
import { useSteamCollections } from "../tradeups/hooks/useSteamCollections";
import type { Exterior, TradeupInputFormRow } from "../tradeups/types";
import "./CollectionAnalyzer.css";

const TRADEUP_RARITIES: TargetRarity[] = [
  "Covert",
  "Classified",
  "Restricted",
  "Mil-Spec",
  "Industrial",
];

const TARGET_RARITY_TITLES: Record<TargetRarity, string> = {
  Covert: "Covert",
  Classified: "Classified",
  Restricted: "Restricted",
  "Mil-Spec": "Mil-Spec",
  Industrial: "Industrial",
  Consumer: "Consumer",
};

interface CollectionAnalysisInputEntry {
  marketHashName: string;
  count: number;
  unitPrice: number;
  totalPrice: number;
  minFloat: number | null;
  maxFloat: number | null;
}

interface CollectionAnalysisTargetOption {
  marketHashName: string;
  price: number;
  exterior: Exterior;
}

interface CollectionAnalysisEntry {
  key: string;
  targetRarity: TargetRarity;
  inputRarity: string | null;
  targetBaseName: string;
  targetMarketHashName: string;
  targetExterior: Exterior;
  targetPrice: number;
  possibleTargets: CollectionAnalysisTargetOption[];
  inputs: CollectionAnalysisInputEntry[];
  totalInputCost: number;
  ratioPercent: number;
  profitProbability: number | null;
}

interface CollectionAnalysis {
  entries: CollectionAnalysisEntry[];
  warnings: string[];
}

interface BulkCollectionAnalysisResult {
  collection: SteamCollectionSummary;
  analysis: CollectionAnalysis | null;
  error: string | null;
}

interface BulkAnalysisProgress {
  total: number;
  completed: number;
  currentTag: string | null;
  currentName: string | null;
}

interface BulkAnalysisTopEntry {
  collectionTag: string;
  collectionName: string;
  entry: CollectionAnalysisEntry;
}

interface RarityPreparation {
  targets: CollectionTargetsResponse["targets"];
  inputRarity: string | null;
  pricedInputs: CollectionInputSummary[];
  collectionId: string | null;
  targetPriceLookup: Map<string, number>;
}

interface TradeupEvaluationResult {
  targets: CollectionAnalysisTargetOption[];
  profitProbability: number | null;
}

interface BuildEntryParams {
  collectionTag: string;
  targetRarity: TargetRarity;
  target: CollectionTargetsResponse["targets"][number];
  exterior: CollectionTargetsResponse["targets"][number]["exteriors"][number];
  rarityData: RarityPreparation;
}

const INPUTS_REQUIRED = 10;
const RATIO_EPSILON = 0.0001;

// --- Форматирование отображаемых значений ---
const formatCurrency = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);

const formatFloat = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 5,
    maximumFractionDigits: 5,
  }).format(value);

const formatProbabilityPercent = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);

const formatFloatRange = (min: number | null, max: number | null) => {
  if (min == null && max == null) {
    return "";
  }
  if (min != null && max != null) {
    if (Math.abs(min - max) <= 0.00001) {
      return formatFloat(min);
    }
    return `${formatFloat(min)}–${formatFloat(max)}`;
  }
  const value = min ?? max;
  return value == null ? "" : formatFloat(value);
};

// --- Построение целевых ключей и вариантов ---
const buildTargetKey = (
  rarity: TargetRarity,
  target: CollectionTargetsResponse["targets"][number],
  exterior: CollectionTargetsResponse["targets"][number]["exteriors"][number],
) => `${rarity}:${target.baseName}:${exterior.marketHashName}`;

const buildTargetOptions = (
  targets: CollectionTargetsResponse["targets"],
): CollectionAnalysisTargetOption[] => {
  const options = new Map<string, CollectionAnalysisTargetOption>();
  targets.forEach((target) => {
    target.exteriors.forEach((exterior) => {
      const price = exterior.price ?? null;
      if (price == null || price <= 0) return;
      const entry: CollectionAnalysisTargetOption = {
        marketHashName: exterior.marketHashName,
        price,
        exterior: exterior.exterior,
      };
      options.set(exterior.marketHashName, entry);
    });
  });

  return Array.from(options.values()).sort((a, b) => {
    if (b.price !== a.price) return b.price - a.price;
    return a.marketHashName.localeCompare(b.marketHashName, "ru");
  });
};

const prioritizeTargetOptions = (
  options: CollectionAnalysisTargetOption[],
  primaryMarketHashName: string,
): CollectionAnalysisTargetOption[] => {
  const primary = options.filter((option) => option.marketHashName === primaryMarketHashName);
  const rest = options.filter((option) => option.marketHashName !== primaryMarketHashName);
  return [...primary, ...rest];
};

const buildTargetOptionsFromOutcomes = (
  outcomes: TradeupOutcomeResponse[],
  targetCollectionId: string,
  priceLookup: Map<string, number>,
): CollectionAnalysisTargetOption[] => {
  const options = new Map<string, CollectionAnalysisTargetOption>();
  outcomes.forEach((outcome) => {
    if (outcome.collectionId !== targetCollectionId) return;
    if (outcome.probability <= 0) return;
    const fallbackPrice = priceLookup.get(outcome.marketHashName) ?? 0;
    const price = outcome.netPrice ?? fallbackPrice;
    if (price <= 0) return;
    options.set(outcome.marketHashName, {
      marketHashName: outcome.marketHashName,
      price,
      exterior: outcome.exterior,
    });
  });

  return Array.from(options.values()).sort((a, b) => {
    if (b.price !== a.price) return b.price - a.price;
    return a.marketHashName.localeCompare(b.marketHashName, "ru");
  });
};

// --- Загрузка и подготовка данных коллекции ---
const loadRaritiesForCollection = async (
  collectionTag: string,
  warnings: string[],
): Promise<TargetRarity[]> => {
  try {
    const availableRarities = await fetchCollectionRarities(collectionTag);
    const filtered = TRADEUP_RARITIES.filter((rarity) => availableRarities.includes(rarity));
    if (filtered.length) {
      return filtered;
    }
    warnings.push("В коллекции нет подходящих редкостей для анализа trade-up.");
    return [];
  } catch (error: any) {
    warnings.push(
      `Не удалось загрузить список редкостей коллекции: ${String(error?.message || error)}`,
    );
    return TRADEUP_RARITIES;
  }
};

const filterPricedInputs = (inputs: CollectionInputSummary[]) =>
  inputs.filter((input) => typeof input.price === "number" && (input.price ?? 0) > 0);

const prepareRarityData = async (
  collectionTag: string,
  targetRarity: TargetRarity,
  warnings: string[],
): Promise<RarityPreparation | null> => {
  let targetsResponse: CollectionTargetsResponse;
  try {
    targetsResponse = await fetchCollectionTargets(collectionTag, targetRarity);
  } catch (error: any) {
    warnings.push(
      `Не удалось загрузить результаты редкости ${TARGET_RARITY_TITLES[targetRarity]}: ${String(
        error?.message || error,
      )}`,
    );
    return null;
  }

  const targets = targetsResponse.targets ?? [];
  if (!targets.length) {
    return null;
  }

  let inputsResponse: Awaited<ReturnType<typeof fetchCollectionInputs>>;
  try {
    inputsResponse = await fetchCollectionInputs(collectionTag, targetRarity);
  } catch (error: any) {
    warnings.push(
      `Не удалось загрузить входы для редкости ${TARGET_RARITY_TITLES[targetRarity]}: ${String(
        error?.message || error,
      )}`,
    );
    return null;
  }

  const pricedInputs = filterPricedInputs(inputsResponse.inputs ?? []);
  if (!pricedInputs.length) {
    warnings.push(
      `Нет цен для входов (${inputsResponse.rarity ?? "?"}) в коллекции ${collectionTag}.`,
    );
    return null;
  }

  const effectiveCollectionId = inputsResponse.collectionId ?? targetsResponse.collectionId ?? null;
  const targetOptions = buildTargetOptions(targets);
  const targetPriceLookup = new Map(
    targetOptions.map((option) => [option.marketHashName, option.price] as const),
  );

  return {
    targets,
    inputRarity: inputsResponse.rarity ?? targetsResponse.rarity ?? null,
    pricedInputs,
    collectionId: effectiveCollectionId,
    targetPriceLookup,
  };
};

// --- Формирование планов и агрегация данных ---
const filterValidPlanRows = (rows: TradeupInputFormRow[]) =>
  rows.filter((row) => row.marketHashName.trim() && row.price.trim());

const buildPlanRowsForTarget = ({
  collectionTag,
  collectionId,
  inputs,
  target,
  exterior,
}: {
  collectionTag: string;
  collectionId: string | null;
  inputs: CollectionInputSummary[];
  target: CollectionTargetsResponse["targets"][number];
  exterior: CollectionTargetsResponse["targets"][number]["exteriors"][number];
}): TradeupInputFormRow[] | null => {
  const { rows } = planRowsForCollection({
    collectionTag,
    collectionId,
    selectedCollectionId: null,
    inputs,
    options: {
      target: {
        exterior: exterior.exterior,
        minFloat: exterior.minFloat ?? null,
        maxFloat: exterior.maxFloat ?? null,
      },
    },
  });

  const validRows = filterValidPlanRows(rows);
  if (validRows.length < INPUTS_REQUIRED) {
    return null;
  }
  return validRows.slice(0, INPUTS_REQUIRED);
};

const summarizePlanRows = (
  planRows: TradeupInputFormRow[],
): { inputs: CollectionAnalysisInputEntry[]; totalInputCost: number } | null => {
  const inputsByName = new Map<
    string,
    { count: number; total: number; minFloat: number | null; maxFloat: number | null }
  >();
  let totalInputCost = 0;

  for (const row of planRows) {
    const price = Number.parseFloat(row.price);
    if (!Number.isFinite(price) || price <= 0) {
      return null;
    }

    totalInputCost += price;

    const floatValue = Number.parseFloat(row.float);
    const current =
      inputsByName.get(row.marketHashName) ??
      { count: 0, total: 0, minFloat: null, maxFloat: null };

    current.count += 1;
    current.total += price;

    if (Number.isFinite(floatValue)) {
      current.minFloat =
        current.minFloat == null ? floatValue : Math.min(current.minFloat, floatValue);
      current.maxFloat =
        current.maxFloat == null ? floatValue : Math.max(current.maxFloat, floatValue);
    }

    inputsByName.set(row.marketHashName, current);
  }

  if (totalInputCost <= 0) {
    return null;
  }

  const inputs = Array.from(inputsByName.entries()).map(
    ([marketHashName, { count, total, minFloat, maxFloat }]) => ({
      marketHashName,
      count,
      totalPrice: total,
      unitPrice: total / count,
      minFloat,
      maxFloat,
    }),
  );

  inputs.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.unitPrice !== b.unitPrice) return a.unitPrice - b.unitPrice;
    return a.marketHashName.localeCompare(b.marketHashName, "ru");
  });

  return { inputs, totalInputCost };
};

const buildTradeupPayload = (
  planRows: TradeupInputFormRow[],
  collectionId: string | null,
): TradeupInputPayload[] | null => {
  if (!collectionId) {
    return null;
  }

  const payload: TradeupInputPayload[] = [];

  for (const row of planRows) {
    const floatValue = Number.parseFloat(row.float);
    if (!Number.isFinite(floatValue)) {
      return null;
    }

    payload.push({
      marketHashName: row.marketHashName,
      float: floatValue,
      collectionId,
      minFloat: floatValue,
      maxFloat: floatValue,
    });
  }

  return payload.length === INPUTS_REQUIRED ? payload : null;
};

const calculateProfitProbability = (
  outcomes: TradeupOutcomeResponse[],
  targetCollectionId: string,
  targetPriceLookup: Map<string, number>,
  totalInputCost: number,
  resolvedTargets: CollectionAnalysisTargetOption[],
): number | null => {
  const priceByOutcome = new Map(
    resolvedTargets.map((option) => [option.marketHashName, option.price] as const),
  );

  const totalProfitProbability = outcomes.reduce((sum, outcome) => {
    if (outcome.collectionId !== targetCollectionId) return sum;
    if (outcome.probability <= 0) return sum;
    const outcomePrice =
      priceByOutcome.get(outcome.marketHashName) ??
      targetPriceLookup.get(outcome.marketHashName) ??
      0;
    if (outcomePrice <= totalInputCost) {
      return sum;
    }
    return sum + outcome.probability;
  }, 0);

  const normalized = Math.min(Math.max(totalProfitProbability, 0), 1);
  return Number.isFinite(normalized) ? normalized : null;
};

const evaluateTradeupOutcomes = async (
  payload: TradeupInputPayload[] | null,
  targetCollectionId: string | null,
  targetRarity: TargetRarity,
  targetPriceLookup: Map<string, number>,
  totalInputCost: number,
): Promise<TradeupEvaluationResult> => {
  if (!payload || !targetCollectionId) {
    return { targets: [], profitProbability: null };
  }

  try {
    const calculation = await requestTradeupCalculation({
      inputs: payload,
      targetCollectionIds: [targetCollectionId],
      targetRarity,
    });

    const resolvedTargets = buildTargetOptionsFromOutcomes(
      calculation.outcomes,
      targetCollectionId,
      targetPriceLookup,
    );

    if (!resolvedTargets.length) {
      return { targets: [], profitProbability: null };
    }

    const profitProbability = calculateProfitProbability(
      calculation.outcomes,
      targetCollectionId,
      targetPriceLookup,
      totalInputCost,
      resolvedTargets,
    );

    return { targets: resolvedTargets, profitProbability };
  } catch {
    return { targets: [], profitProbability: null };
  }
};

const buildEntryForTarget = async ({
  collectionTag,
  targetRarity,
  target,
  exterior,
  rarityData,
}: BuildEntryParams): Promise<CollectionAnalysisEntry | null> => {
  const targetPrice = exterior.price ?? null;
  if (targetPrice == null || targetPrice <= 0) {
    return null;
  }

  const planRows = buildPlanRowsForTarget({
    collectionTag,
    collectionId: rarityData.collectionId,
    inputs: rarityData.pricedInputs,
    target,
    exterior,
  });

  if (!planRows) {
    return null;
  }

  const summary = summarizePlanRows(planRows);
  if (!summary) {
    return null;
  }

  const payload = buildTradeupPayload(planRows, rarityData.collectionId);
  const { targets: resolvedTargets, profitProbability } = await evaluateTradeupOutcomes(
    payload,
    rarityData.collectionId,
    targetRarity,
    rarityData.targetPriceLookup,
    summary.totalInputCost,
  );

  const prioritizedTargets = resolvedTargets.length
    ? prioritizeTargetOptions(resolvedTargets, exterior.marketHashName)
    : [];

  const primaryTargetPrice =
    prioritizedTargets.find((option) => option.marketHashName === exterior.marketHashName)?.price ??
    prioritizedTargets[0]?.price ??
    targetPrice;

  const ratioPercent = (primaryTargetPrice / summary.totalInputCost) * 100;

  return {
    key: buildTargetKey(targetRarity, target, exterior),
    targetRarity,
    inputRarity: rarityData.inputRarity,
    targetBaseName: target.baseName,
    targetMarketHashName: exterior.marketHashName,
    targetExterior: exterior.exterior,
    targetPrice,
    possibleTargets: prioritizedTargets,
    inputs: summary.inputs,
    totalInputCost: summary.totalInputCost,
    ratioPercent,
    profitProbability,
  };
};

const registerBestEntry = (
  registry: Map<string, CollectionAnalysisEntry>,
  entry: CollectionAnalysisEntry,
) => {
  const current = registry.get(entry.key);
  if (!current) {
    registry.set(entry.key, entry);
    return;
  }

  if (entry.ratioPercent > current.ratioPercent + RATIO_EPSILON) {
    registry.set(entry.key, entry);
    return;
  }

  if (current.ratioPercent > entry.ratioPercent + RATIO_EPSILON) {
    return;
  }

  const currentProfit = current.profitProbability ?? 0;
  const nextProfit = entry.profitProbability ?? 0;

  if (nextProfit > currentProfit) {
    registry.set(entry.key, entry);
  }
};

const finalizeEntries = (registry: Map<string, CollectionAnalysisEntry>) => {
  let entries = Array.from(registry.values());

  if (entries.length) {
    const raritiesPresent = new Set(entries.map((entry) => entry.targetRarity));
    const rarityToExclude = [...TRADEUP_RARITIES]
      .reverse()
      .find((rarity) => raritiesPresent.has(rarity));

    if (rarityToExclude) {
      const filtered = entries.filter((entry) => entry.targetRarity !== rarityToExclude);
      if (filtered.length) {
        entries = filtered;
      }
    }
  }

  entries.sort((a, b) => {
    if (b.ratioPercent !== a.ratioPercent) {
      return b.ratioPercent - a.ratioPercent;
    }
    const profitA = a.profitProbability ?? 0;
    const profitB = b.profitProbability ?? 0;
    if (profitB !== profitA) {
      return profitB - profitA;
    }
    return a.targetMarketHashName.localeCompare(b.targetMarketHashName, "ru");
  });

  return entries;
};

// --- Основная функция анализа коллекции ---
const analyzeCollection = async (collectionTag: string): Promise<CollectionAnalysis> => {
  const warnings: string[] = [];
  const raritiesToCheck = await loadRaritiesForCollection(collectionTag, warnings);

  if (!raritiesToCheck.length) {
    return { entries: [], warnings };
  }

  const bestByTarget = new Map<string, CollectionAnalysisEntry>();

  for (const targetRarity of raritiesToCheck) {
    const rarityData = await prepareRarityData(collectionTag, targetRarity, warnings);
    if (!rarityData) {
      continue;
    }

    for (const target of rarityData.targets) {
      for (const exterior of target.exteriors) {
        const entry = await buildEntryForTarget({
          collectionTag,
          targetRarity,
          target,
          exterior,
          rarityData,
        });

        if (entry) {
          registerBestEntry(bestByTarget, entry);
        }
      }
    }
  }

  const entries = finalizeEntries(bestByTarget);
  return { entries, warnings };
};

// --- Вспомогательные хуки интерфейса ---
const useCollectionAnalysis = (collectionTag: string | null) => {
  const [analysis, setAnalysis] = React.useState<CollectionAnalysis | null>(null);
  const [analysisError, setAnalysisError] = React.useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = React.useState(false);

  React.useEffect(() => {
    if (!collectionTag) {
      setAnalysis(null);
      setAnalysisError(null);
      setAnalysisLoading(false);
      return;
    }

    let cancelled = false;
    setAnalysis(null);
    setAnalysisError(null);
    setAnalysisLoading(true);

    (async () => {
      try {
        const result = await analyzeCollection(collectionTag);
        if (!cancelled) {
          setAnalysis(result);
        }
      } catch (error: any) {
        if (!cancelled) {
          setAnalysisError(String(error?.message || error));
        }
      } finally {
        if (!cancelled) {
          setAnalysisLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [collectionTag]);

  return { analysis, analysisError, analysisLoading };
};

// --- Компонент анализа коллекций ---
const CollectionAnalyzer: React.FC = () => {
  const { collections, loading, error, load } = useSteamCollections();
  const [filter, setFilter] = React.useState("");
  const [selectedTag, setSelectedTag] = React.useState<string | null>(null);
  const { analysis, analysisError, analysisLoading } = useCollectionAnalysis(selectedTag);
  const [bulkResults, setBulkResults] = React.useState<BulkCollectionAnalysisResult[]>([]);
  const [bulkRunning, setBulkRunning] = React.useState(false);
  const [bulkProgress, setBulkProgress] = React.useState<BulkAnalysisProgress | null>(null);

  React.useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  React.useEffect(() => {
    if (!collections.length) return;
    if (selectedTag && collections.some((collection) => collection.tag === selectedTag)) {
      return;
    }
    setSelectedTag(collections[0]?.tag ?? null);
  }, [collections, selectedTag]);

  const filteredCollections = React.useMemo(() => {
    if (!filter.trim()) return collections;
    const needle = filter.trim().toLowerCase();
    return collections.filter((collection) =>
      collection.name.toLowerCase().includes(needle) || collection.tag.toLowerCase().includes(needle),
    );
  }, [collections, filter]);

  const handleAnalyzeAll = React.useCallback(async () => {
    if (!collections.length || bulkRunning) {
      return;
    }

    setBulkRunning(true);
    setBulkResults([]);
    setBulkProgress({ total: collections.length, completed: 0, currentTag: null, currentName: null });

    const results: BulkCollectionAnalysisResult[] = [];

    try {
      for (const collection of collections) {
        setBulkProgress((previous) =>
          previous
            ? {
                ...previous,
                currentTag: collection.tag,
                currentName: collection.name,
              }
            : previous,
        );

        try {
          const result = await analyzeCollection(collection.tag);
          results.push({ collection, analysis: result, error: null });
        } catch (error: any) {
          results.push({
            collection,
            analysis: null,
            error: String(error?.message || error),
          });
        }

        setBulkResults([...results]);
        setBulkProgress((previous) =>
          previous
            ? {
                ...previous,
                completed: previous.completed + 1,
              }
            : previous,
        );
      }
    } finally {
      setBulkProgress((previous) =>
        previous
          ? {
              ...previous,
              currentTag: null,
              currentName: null,
            }
          : previous,
      );
      setBulkRunning(false);
    }
  }, [collections, bulkRunning]);

  const bulkErrors = React.useMemo(() => bulkResults.filter((entry) => entry.error), [bulkResults]);

  const bulkTopEntries = React.useMemo(() => {
    const aggregated: BulkAnalysisTopEntry[] = [];
    for (const result of bulkResults) {
      if (!result.analysis?.entries?.length) continue;
      for (const entry of result.analysis.entries) {
        aggregated.push({
          collectionTag: result.collection.tag,
          collectionName: result.collection.name,
          entry,
        });
      }
    }

    aggregated.sort((a, b) => {
      if (b.entry.ratioPercent !== a.entry.ratioPercent) {
        return b.entry.ratioPercent - a.entry.ratioPercent;
      }
      const profitA = a.entry.profitProbability ?? 0;
      const profitB = b.entry.profitProbability ?? 0;
      if (profitB !== profitA) {
        return profitB - profitA;
      }
      return a.entry.targetMarketHashName.localeCompare(b.entry.targetMarketHashName, "ru");
    });

    return aggregated.slice(0, 15);
  }, [bulkResults]);

  const activeCollection = React.useMemo(
    () => collections.find((collection) => collection.tag === selectedTag) ?? null,
    [collections, selectedTag],
  );

  const maxRatio = React.useMemo(() => {
    if (!analysis?.entries?.length) return 0;
    return analysis.entries.reduce((max, entry) => Math.max(max, entry.ratioPercent), 0);
  }, [analysis]);

  return (
    <div className="card bg-dark text-white p-3">
      <div className="collection-analyzer">
        <div>
          <h2 className="h4 mb-1">Анализ коллекций</h2>
          <p className="text-secondary small mb-0">
            Выберите коллекцию, чтобы найти самые выгодные варианты trade-up. Сравнение строится по
            соотношению цены результата к стоимости 10 входных скинов.
          </p>
        </div>
        <div className="collection-analyzer__layout">
          <div className="collection-analyzer__collections">
            <div className="collection-analyzer__collections-search">
              <input
                type="search"
                className="form-control form-control-sm"
                placeholder="Название или тег Steam"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div className="collection-analyzer__collections-actions">
              <button
                type="button"
                className="btn btn-outline-light btn-sm"
                onClick={handleAnalyzeAll}
                disabled={bulkRunning || !collections.length}
              >
                Анализировать все
              </button>
              {bulkRunning && bulkProgress ? (
                <div className="collection-analyzer__bulk-status">
                  Анализ {Math.min(bulkProgress.completed + 1, bulkProgress.total)} из {bulkProgress.total}
                  {bulkProgress.currentName ? ` • ${bulkProgress.currentName}` : ""}
                </div>
              ) : null}
              {!bulkRunning && bulkProgress?.total ? (
                <div className="collection-analyzer__bulk-status">
                  Проанализировано: {bulkProgress.completed} из {bulkProgress.total}
                  {bulkErrors.length ? ` • Ошибок: ${bulkErrors.length}` : ""}
                </div>
              ) : null}
            </div>
            <div className="collection-analyzer__collections-list">
              {loading && <div className="text-secondary small">Загрузка…</div>}
              {!loading && error && <div className="collection-analyzer__error">{error}</div>}
              {!loading && !error && !filteredCollections.length && (
                <div className="collection-analyzer__empty">Коллекции не найдены.</div>
              )}
              {!loading && !error &&
                filteredCollections.map((collection) => {
                  const isActive = collection.tag === selectedTag;
                  return (
                    <button
                      key={collection.tag}
                      type="button"
                      className={`btn btn-sm ${isActive ? "btn-primary" : "btn-outline-light"}`}
                      onClick={() => setSelectedTag(collection.tag)}
                    >
                      <div className="fw-semibold">{collection.name}</div>
                      <div className="small text-secondary">{collection.count} предметов</div>
                    </button>
                  );
                })}
            </div>
          </div>
          <div className="collection-analyzer__results">
            <div className="collection-analyzer__summary">
              <div className="h5 mb-0">{activeCollection?.name ?? "Коллекция"}</div>
              {activeCollection && (
                <span className="text-secondary">
                  Steam tag: {activeCollection.tag} • {activeCollection.count} предметов
                </span>
              )}
            </div>
            {analysisLoading && <div className="text-secondary">Подбор контрактов…</div>}
            {!analysisLoading && analysisError && (
              <div className="collection-analyzer__error">{analysisError}</div>
            )}
            {!analysisLoading && !analysisError && !analysis?.entries.length && (
              <div className="collection-analyzer__empty">
                Не удалось подобрать контракты: нет данных о ценах.
              </div>
            )}
            {!analysisLoading && !analysisError && analysis?.entries.length ? (
              <div className="collection-chart">
                {analysis.entries.map((entry) => {
                  const width = maxRatio > 0 ? Math.max((entry.ratioPercent / maxRatio) * 100, 2) : 0;
                  const targetsToDisplay = entry.possibleTargets.length
                    ? entry.possibleTargets
                    : ([
                        {
                          marketHashName: entry.targetMarketHashName,
                          price: entry.targetPrice,
                          exterior: entry.targetExterior,
                        },
                      ] as CollectionAnalysisTargetOption[]);
                  return (
                    <div key={entry.key} className="collection-chart__row">
                      <div className="collection-chart__label">
                        <div className="collection-chart__targets">
                          <div className="fw-semibold">Возможные результаты:</div>
                          <div className="collection-chart__targets-list">
                            {targetsToDisplay.map((target, index) => (
                              <React.Fragment key={`${entry.key}:${target.marketHashName}`}>
                                {index > 0 ? ", " : " "}
                                <span
                                  className={`collection-chart__target${
                                    target.marketHashName === entry.targetMarketHashName
                                      ? " collection-chart__target--primary"
                                      : ""
                                  }`}
                                >
                                  {target.marketHashName}
                                  <span className="text-secondary ms-1">
                                    ({formatCurrency(target.price)})
                                  </span>
                                </span>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                        <div className="collection-chart__meta">
                          {TARGET_RARITY_TITLES[entry.targetRarity]}
                          {entry.inputRarity ? ` • вход: ${entry.inputRarity}` : ""}
                        </div>
                        <div className="collection-chart__inputs">
                          Лучший вход:
                          {entry.inputs.map((input, index) => {
                            const floatLabel = formatFloatRange(input.minFloat, input.maxFloat);
                            return (
                              <React.Fragment key={`${entry.key}:${input.marketHashName}:${index}`}>
                                {index > 0 ? ", " : " "}
                                {input.marketHashName} × {input.count} ({formatCurrency(input.unitPrice)} за слот
                                {floatLabel ? `, float ${floatLabel}` : ""})
                              </React.Fragment>
                            );
                          })}
                          {" • Σ "}
                          {formatCurrency(entry.totalInputCost)}
                        </div>
                        {entry.profitProbability != null ? (
                          <div
                            className={`collection-chart__profit ${
                              entry.profitProbability > 0 ? "text-success" : "text-secondary"
                            }`}
                          >
                            Вероятность прибыли: {formatProbabilityPercent(entry.profitProbability)}
                          </div>
                        ) : null}
                      </div>
                      <div className="collection-chart__bar">
                        <div className="collection-chart__bar-fill" style={{ width: `${width}%` }} />
                        <div className="collection-chart__value">{entry.ratioPercent.toFixed(1)}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {analysis?.warnings?.length ? (
              <div className="text-warning small">
                {analysis.warnings.map((warning, index) => (
                  <div key={index}>{warning}</div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {bulkResults.length ? (
          <div className="collection-analyzer__bulk-results">
            <div>
              <h3 className="h5 mb-1">Результаты массового анализа</h3>
              <div className="text-secondary small">
                Коллекций: {bulkResults.length} • Успешно: {bulkResults.length - bulkErrors.length}
                {bulkErrors.length ? ` • Ошибок: ${bulkErrors.length}` : ""}
              </div>
            </div>
            {bulkTopEntries.length ? (
              <ul className="collection-analyzer__bulk-list">
                {bulkTopEntries.map((item) => (
                  <li key={`${item.collectionTag}:${item.entry.key}`}>
                    <div className="collection-analyzer__bulk-entry">
                      <div className="collection-analyzer__bulk-entry-info">
                        <div className="fw-semibold">{item.collectionName}</div>
                        <div className="text-secondary small">
                          {item.entry.targetMarketHashName} • {TARGET_RARITY_TITLES[item.entry.targetRarity]}
                        </div>
                      </div>
                      <div className="collection-analyzer__bulk-metrics">
                        <span className="collection-analyzer__bulk-metric">
                          {formatCurrency(item.entry.targetPrice)}
                        </span>
                        <span className="collection-analyzer__bulk-metric">
                          ROI {item.entry.ratioPercent.toFixed(1)}%
                        </span>
                        {item.entry.profitProbability != null ? (
                          <span className="collection-analyzer__bulk-metric">
                            Профит {formatProbabilityPercent(item.entry.profitProbability)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-secondary small">
                Не удалось подобрать выгодные контракты для выбранных коллекций.
              </div>
            )}
            {bulkErrors.length ? (
              <div className="text-warning small">
                Ошибки при обработке: {" "}
                {bulkErrors
                  .slice(0, 5)
                  .map((entry) => entry.collection.name)
                  .join(", ")}
                {bulkErrors.length > 5 ? " и другие." : "."}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

};

export default CollectionAnalyzer;
