import React from "react";
import {
  fetchCollectionTargets,
  fetchCollectionInputs,
  fetchCollectionRarities,
  requestTradeupCalculation,
  type CollectionTargetsResponse,
  type TargetRarity,
  type TradeupInputPayload,
  type TradeupOutcomeResponse,
} from "../tradeups/services/api";
import { planRowsForCollection } from "../tradeups/hooks/rowPlanning";
import { useSteamCollections } from "../tradeups/hooks/builder/useSteamCollections";
import type { Exterior } from "../skins/services/types";
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
}

interface CollectionAnalysis {
  entries: CollectionAnalysisEntry[];
  warnings: string[];
}

const INPUTS_REQUIRED = 10;

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

const analyzeCollection = async (collectionTag: string): Promise<CollectionAnalysis> => {
  const bestByTarget = new Map<string, CollectionAnalysisEntry>();
  const warnings: string[] = [];

  let raritiesToCheck: TargetRarity[] = [];
  try {
    const availableRarities = await fetchCollectionRarities(collectionTag);
    const filtered = TRADEUP_RARITIES.filter((rarity) => availableRarities.includes(rarity));
    if (filtered.length) {
      raritiesToCheck = filtered;
    } else {
      warnings.push("В коллекции нет подходящих редкостей для анализа trade-up.");
    }
  } catch (error: any) {
    warnings.push(
      `Не удалось загрузить список редкостей коллекции: ${String(error?.message || error)}`,
    );
    raritiesToCheck = TRADEUP_RARITIES;
  }

  if (!raritiesToCheck.length) {
    return { entries: [], warnings };
  }

  for (const targetRarity of raritiesToCheck) {
    let targets: CollectionTargetsResponse["targets"]; // undefined until fetched
    let inputRarity: string | null = null;

    let targetsResponse: CollectionTargetsResponse;
    try {
      targetsResponse = await fetchCollectionTargets(collectionTag, targetRarity);
      targets = targetsResponse.targets ?? [];
      if (!targets.length) {
        continue;
      }
      inputRarity = targetsResponse.rarity ?? null;
    } catch (error: any) {
      warnings.push(
        `Не удалось загрузить результаты редкости ${TARGET_RARITY_TITLES[targetRarity]}: ${String(
          error?.message || error,
        )}`,
      );
      continue;
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
      continue;
    }

    inputRarity = inputsResponse.rarity ?? inputRarity;
    const inputsList = inputsResponse.inputs ?? [];

    const pricedInputs = inputsList.filter(
      (input) => typeof input.price === "number" && (input.price ?? 0) > 0,
    );
    if (!pricedInputs.length) {
      warnings.push(
        `Нет цен для входов (${inputsResponse.rarity ?? "?"}) в коллекции ${collectionTag}.`,
      );
      continue;
    }

    const effectiveCollectionId =
      inputsResponse.collectionId ?? targetsResponse.collectionId ?? null;

    const targetOptions = buildTargetOptions(targets);
    const targetPriceLookup = new Map(
      targetOptions.map((option) => [option.marketHashName, option.price] as const),
    );

    for (const target of targets) {
      for (const exterior of target.exteriors) {
        const targetPrice = exterior.price ?? null;
        if (targetPrice == null || targetPrice <= 0) {
          continue;
        }

        const { rows } = planRowsForCollection({
          collectionTag,
          collectionId: effectiveCollectionId,
          selectedCollectionId: null,
          inputs: pricedInputs,
          options: {
            target: {
              exterior: exterior.exterior,
              minFloat: exterior.minFloat ?? null,
              maxFloat: exterior.maxFloat ?? null,
            },
          },
        });

        const validRows = rows.filter((row) => row.marketHashName && row.price.trim());
        if (validRows.length < INPUTS_REQUIRED) {
          continue;
        }

        const planRows = validRows.slice(0, INPUTS_REQUIRED);
        let invalidPlan = false;
        const inputsByName = new Map<
          string,
          { count: number; total: number; minFloat: number | null; maxFloat: number | null }
        >();
        let totalInputCost = 0;

        for (const row of planRows) {
          const price = Number.parseFloat(row.price);
          const floatValue = Number.parseFloat(row.float);
          if (!Number.isFinite(price) || price <= 0) {
            invalidPlan = true;
            break;
          }
          totalInputCost += price;
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

        if (invalidPlan || totalInputCost <= 0) {
          continue;
        }

        const inputsPlan = Array.from(inputsByName.entries()).map(
          ([marketHashName, { count, total, minFloat, maxFloat }]) => ({
            marketHashName,
            count,
            totalPrice: total,
            unitPrice: total / count,
            minFloat,
            maxFloat,
          }),
        );

        inputsPlan.sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          if (a.unitPrice !== b.unitPrice) return a.unitPrice - b.unitPrice;
          return a.marketHashName.localeCompare(b.marketHashName, "ru");
        });

        const ratioPercent = (targetPrice / totalInputCost) * 100;
        const key = buildTargetKey(targetRarity, target, exterior);
        const current = bestByTarget.get(key);
        if (!current || ratioPercent > current.ratioPercent) {
          let resolvedPossibleTargets: CollectionAnalysisTargetOption[] = [];
          if (effectiveCollectionId) {
            const tradeupInputs: TradeupInputPayload[] = [];
            let hasInvalidTradeupInput = false;

            for (const row of planRows) {
              const floatValue = Number.parseFloat(row.float);
              if (!Number.isFinite(floatValue)) {
                hasInvalidTradeupInput = true;
                break;
              }

              tradeupInputs.push({
                marketHashName: row.marketHashName,
                float: floatValue,
                collectionId: effectiveCollectionId,
                minFloat: floatValue,
                maxFloat: floatValue,
              });
            }

            if (!hasInvalidTradeupInput && tradeupInputs.length === INPUTS_REQUIRED) {
              try {
                const calculation = await requestTradeupCalculation({
                  inputs: tradeupInputs,
                  targetCollectionIds: [effectiveCollectionId],
                  targetRarity,
                });
                resolvedPossibleTargets = buildTargetOptionsFromOutcomes(
                  calculation.outcomes,
                  effectiveCollectionId,
                  targetPriceLookup,
                );
              } catch (error) {
                // ignore calculation errors for analysis view
              }
            }
          }

          const prioritizedTargets = resolvedPossibleTargets.length
            ? prioritizeTargetOptions(resolvedPossibleTargets, exterior.marketHashName)
            : [];

          bestByTarget.set(key, {
            key,
            targetRarity,
            inputRarity,
            targetBaseName: target.baseName,
            targetMarketHashName: exterior.marketHashName,
            targetExterior: exterior.exterior,
            targetPrice,
            possibleTargets: prioritizedTargets,
            inputs: inputsPlan,
            totalInputCost,
            ratioPercent,
          });
        }
      }
    }
  }

  let entries = Array.from(bestByTarget.values());

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

  entries.sort((a, b) => b.ratioPercent - a.ratioPercent);
  return { entries, warnings };
};

const CollectionAnalyzer: React.FC = () => {
  const { collections, loading, error, load } = useSteamCollections();
  const [filter, setFilter] = React.useState("");
  const [selectedTag, setSelectedTag] = React.useState<string | null>(null);
  const [analysis, setAnalysis] = React.useState<CollectionAnalysis | null>(null);
  const [analysisError, setAnalysisError] = React.useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = React.useState(false);

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

  React.useEffect(() => {
    if (!selectedTag) {
      setAnalysis(null);
      setAnalysisError(null);
      return;
    }

    let cancelled = false;
    setAnalysis(null);
    setAnalysisError(null);
    setAnalysisLoading(true);

    (async () => {
      try {
        const result = await analyzeCollection(selectedTag);
        if (cancelled) return;
        setAnalysis(result);
      } catch (error: any) {
        if (cancelled) return;
        setAnalysisError(String(error?.message || error));
      } finally {
        if (cancelled) return;
        setAnalysisLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedTag]);

  const filteredCollections = React.useMemo(() => {
    if (!filter.trim()) return collections;
    const needle = filter.trim().toLowerCase();
    return collections.filter((collection) =>
      collection.name.toLowerCase().includes(needle) || collection.tag.toLowerCase().includes(needle),
    );
  }, [collections, filter]);

  const activeCollection = React.useMemo(
    () => collections.find((collection) => collection.tag === selectedTag) ?? null,
    [collections, selectedTag],
  );

  const maxRatio = React.useMemo(() => {
    if (!analysis?.entries?.length) return 0;
    return analysis.entries.reduce((max, entry) => Math.max(max, entry.ratioPercent), 0);
  }, [analysis]);

  return (
    <div className="collection-analyzer">
      <div>
        <h2 className="h4">Анализ коллекций</h2>
        <p className="text-secondary">
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
              placeholder="Поиск коллекции"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
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
    </div>
  );
};

export default CollectionAnalyzer;
