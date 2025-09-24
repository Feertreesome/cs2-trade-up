import React from "react";
import type { Exterior } from "../../skins/services/types";
import { parseExterior } from "../../skins/services/utils";
import {
  batchPriceOverview,
  fetchCollectionInputs,
  fetchCollectionTargets,
  fetchSteamCollections,
  fetchTradeupCollections,
  requestTradeupCalculation,
  type CollectionInputSummary,
  type CollectionTargetExterior,
  type CollectionTargetsResponse,
  type SteamCollectionSummary,
  type TradeupCalculationResponse,
  type TradeupCollection,
} from "../services/api";

/**
 * Хук инкапсулирует весь state и бизнес-логику для TradeupBuilder:
 * загрузку справочников, выбор целей, управление входами и отправку расчёта на сервер.
 */

export interface TradeupInputFormRow {
  marketHashName: string;
  /**
   * Значение селекта коллекций. Может содержать как внутренний идентификатор коллекции,
   * так и fallback на steam-tag (если float-справочник пока не знает эту коллекцию).
   */
  collectionId: string;
  float: string;
  buyerPrice: string;
}

/**
 * Создаёт пустую строку формы ввода trade-up'а.
 * Используется для инициализации и очистки таблицы.
 */
const makeEmptyRow = (): TradeupInputFormRow => ({
  marketHashName: "",
  collectionId: "",
  float: "",
  buyerPrice: "",
});

/** Возвращает массив из десяти пустых строк формы. */
const createInitialRows = () => Array.from({ length: 10 }, makeEmptyRow);

const EXTERIOR_FLOAT_RANGES: Record<Exterior, { min: number; max: number }> = {
  "Factory New": { min: 0, max: 0.07 },
  "Minimal Wear": { min: 0.07, max: 0.15 },
  "Field-Tested": { min: 0.15, max: 0.38 },
  "Well-Worn": { min: 0.38, max: 0.45 },
  "Battle-Scarred": { min: 0.45, max: 1 },
};

const WEAR_BUCKET_SEQUENCE: Array<{ exterior: Exterior; min: number; max: number }> = [
  { exterior: "Factory New", min: 0, max: 0.07 },
  { exterior: "Minimal Wear", min: 0.07, max: 0.15 },
  { exterior: "Field-Tested", min: 0.15, max: 0.38 },
  { exterior: "Well-Worn", min: 0.38, max: 0.45 },
  { exterior: "Battle-Scarred", min: 0.45, max: 1 },
];

/** Ограничивает float-значение диапазоном [0, 1]. */
const clampFloat = (value: number) => Math.min(1, Math.max(0, value));

/** Возвращает середину стандартного диапазона для заданного экстерьера. */
const exteriorMidpoint = (exterior: Exterior) => {
  const range = EXTERIOR_FLOAT_RANGES[exterior];
  if (!range) return null;
  return (range.min + range.max) / 2;
};

/** Форматирует float для отображения в input (пустая строка для null/undefined). */
const formatFloatValue = (value: number | null | undefined) =>
  value == null ? "" : clampFloat(value).toFixed(5);

const STEAM_TAG_VALUE_PREFIX = "steam-tag:";

interface CollectionSelectOption {
  value: string;
  label: string;
  supported: boolean;
}

/**
 * Строит значение для select'а коллекций. Предпочитает внутренний id,
 * но при его отсутствии использует steam-tag с префиксом.
 */
const buildCollectionSelectValue = (
  collectionId?: string | null,
  collectionTag?: string | null,
) => {
  if (collectionId) return collectionId;
  if (collectionTag) return `${STEAM_TAG_VALUE_PREFIX}${collectionTag}`;
  return "";
};

/** Возвращает steam-tag из значения селекта, если он закодирован префиксом. */
const readTagFromCollectionValue = (value: string) =>
  value.startsWith(STEAM_TAG_VALUE_PREFIX)
    ? value.slice(STEAM_TAG_VALUE_PREFIX.length)
    : null;

interface CollectionValueMeta {
  collectionId: string | null;
  tag: string | null;
  name: string;
}

interface SelectedTarget {
  collectionTag: string;
  baseName: string;
  exterior: Exterior;
  marketHashName: string;
  minFloat?: number;
  maxFloat?: number;
  price?: number | null;
}

interface ResolvedTradeupRow {
  marketHashName: string;
  collectionId: string;
  float: number;
  buyerPrice: number;
  resolvedCollectionId: string | null;
  resolvedCollectionName: string | null;
  resolvedTag: string | null;
}

interface FloatlessOutcomeExterior {
  exterior: Exterior;
  probability: number | null;
  buyerPrice: number | null;
  netPrice: number | null;
  marketHashName: string;
}

interface FloatlessOutcomeSummary {
  baseName: string;
  probability: number;
  projectedRange: { min: number; max: number };
  exteriors: FloatlessOutcomeExterior[];
  robustNet: number | null;
  expectedNetContribution: number | null;
  expectedProbabilityCovered: number;
}

interface FloatlessAnalysisResult {
  ready: boolean;
  issues: string[];
  inputRange: { min: number; max: number } | null;
  wearCounts: Partial<Record<Exterior, number>>;
  outcomes: FloatlessOutcomeSummary[];
  robustOutcomeNet: number | null;
  expectedOutcomeNet: number | null;
  robustEV: number | null;
  expectedEV: number | null;
  expectedCoverage: number;
}

interface RowResolution {
  rows: ResolvedTradeupRow[];
  unresolvedNames: string[];
  hasMultipleCollections: boolean;
  resolvedCollectionId: string | null;
  collectionCounts: Map<string, number>;
}

export default function useTradeupBuilder() {
  const [catalogCollections, setCatalogCollections] = React.useState<TradeupCollection[]>([]);
  const [steamCollections, setSteamCollections] = React.useState<SteamCollectionSummary[]>([]);
  const [loadingSteamCollections, setLoadingSteamCollections] = React.useState(false);
  const [steamCollectionError, setSteamCollectionError] = React.useState<string | null>(null);

  const [activeCollectionTag, setActiveCollectionTag] = React.useState<string | null>(null);
  const [targetsByCollection, setTargetsByCollection] = React.useState<
    Record<string, CollectionTargetsResponse>
  >({});
  const [loadingTargets, setLoadingTargets] = React.useState(false);
  const [targetsError, setTargetsError] = React.useState<string | null>(null);

  const [inputsByCollection, setInputsByCollection] = React.useState<
    Record<
      string,
      { collectionId: string | null; collectionTag: string; inputs: CollectionInputSummary[] }
    >
  >({});
  const [inputsLoading, setInputsLoading] = React.useState(false);
  const [inputsError, setInputsError] = React.useState<string | null>(null);

  const [selectedTarget, setSelectedTarget] = React.useState<SelectedTarget | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = React.useState<string | null>(null);

  const [rows, setRows] = React.useState<TradeupInputFormRow[]>(() => createInitialRows());
  const [buyerFeePercent, setBuyerFeePercent] = React.useState<number>(15);

  const [calculation, setCalculation] = React.useState<TradeupCalculationResponse | null>(null);
  const [calculating, setCalculating] = React.useState(false);
  const [calculationError, setCalculationError] = React.useState<string | null>(null);
  const [priceLoading, setPriceLoading] = React.useState(false);
  const [targetPriceOverrides, setTargetPriceOverrides] = React.useState<Record<string, number>>({});

  const buyerToNetRate = 1 + Math.max(0, buyerFeePercent) / 100;

  // При первом рендере подтягиваем встроенный каталог коллекций для подсказок.
  React.useEffect(() => {
    async function loadCatalog() {
      try {
        const list = await fetchTradeupCollections();
        setCatalogCollections(list);
      } catch (error) {
        console.error("Failed to load trade-up catalog", error);
      }
    }
    void loadCatalog();
  }, []);

  /** Быстрый индекс каталога коллекций по внутреннему идентификатору. */
  const catalogMap = React.useMemo(() => {
    return new Map(catalogCollections.map((collection) => [collection.id, collection] as const));
  }, [catalogCollections]);

  /** Отдельная карта steam-tag → информация о коллекции для быстрых lookup'ов. */
  const steamCollectionsByTag = React.useMemo(
    () => new Map(steamCollections.map((entry) => [entry.tag, entry] as const)),
    [steamCollections],
  );

  /**
   * Сводная информация о значениях селекта коллекций.
   * Нужна для корректного отображения названия даже когда данные приходят из разных источников.
   */
  const collectionValueMeta = React.useMemo(() => {
    const valueMetaMap = new Map<string, CollectionValueMeta>();

    const register = (value: string, details: { collectionId: string | null; tag: string | null; name?: string | null }) => {
      if (!value) return;

      const existing = valueMetaMap.get(value);
      const fallbackName =
        (details.collectionId ? catalogMap.get(details.collectionId)?.name : undefined) ??
        (details.tag ? steamCollectionsByTag.get(details.tag)?.name : undefined) ??
        undefined;
      const next: CollectionValueMeta = {
        collectionId: details.collectionId ?? null,
        tag: details.tag ?? null,
        name: details.name ?? fallbackName ?? existing?.name ?? "",
      };

      if (!existing) {
        valueMetaMap.set(value, next);
        return;
      }

      const hasBetterId = !existing.collectionId && next.collectionId;
      const hasBetterName = !existing.name && next.name;
      if (hasBetterId || hasBetterName) {
        valueMetaMap.set(value, {
          collectionId: hasBetterId ? next.collectionId : existing.collectionId,
          tag: next.tag ?? existing.tag,
          name: hasBetterName ? next.name : existing.name,
        });
      }
    };

    for (const entry of steamCollections) {
      const value = buildCollectionSelectValue(entry.collectionId, entry.tag);
      register(value, { collectionId: entry.collectionId ?? null, tag: entry.tag, name: entry.name });
      if (entry.collectionId) {
        register(entry.collectionId, {
          collectionId: entry.collectionId,
          tag: entry.tag,
          name: entry.name,
        });
      }
    }

    for (const entry of Object.values(targetsByCollection)) {
      const value = buildCollectionSelectValue(entry.collectionId, entry.collectionTag);
      register(value, {
        collectionId: entry.collectionId ?? null,
        tag: entry.collectionTag,
      });
      if (entry.collectionId) {
        register(entry.collectionId, {
          collectionId: entry.collectionId,
          tag: entry.collectionTag,
        });
      }
    }

    for (const entry of Object.values(inputsByCollection)) {
      const value = buildCollectionSelectValue(entry.collectionId, entry.collectionTag);
      register(value, {
        collectionId: entry.collectionId ?? null,
        tag: entry.collectionTag,
      });
      if (entry.collectionId) {
        register(entry.collectionId, {
          collectionId: entry.collectionId,
          tag: entry.collectionTag,
        });
      }
    }

    for (const entry of catalogCollections) {
      if (!valueMetaMap.has(entry.id)) {
        register(entry.id, { collectionId: entry.id, tag: null, name: entry.name });
      }
    }

    return valueMetaMap;
  }, [
    steamCollections,
    steamCollectionsByTag,
    targetsByCollection,
    inputsByCollection,
    catalogCollections,
    catalogMap,
  ]);

  /** Опции для выпадающего списка выбора коллекций в таблице входов. */
  const collectionOptions: CollectionSelectOption[] = React.useMemo(() => {
    const map = new Map<string, CollectionSelectOption>();
    const addOption = (value: string, label: string, supported: boolean) => {
      if (!value) return;
      const existing = map.get(value);
      if (existing) {
        if (!existing.supported && supported) {
          map.set(value, { value, label, supported });
        }
        return;
      }
      map.set(value, { value, label, supported });
    };

    for (const entry of steamCollections) {
      const value = buildCollectionSelectValue(entry.collectionId, entry.tag);
      addOption(value, entry.name, Boolean(entry.collectionId && catalogMap.has(entry.collectionId)));
    }

    for (const entry of catalogCollections) {
      addOption(entry.id, entry.name, true);
    }

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [steamCollections, catalogCollections, catalogMap]);

  /** Подробности по выбранной коллекции из локального каталога (для подсказок по float). */
  const selectedCollectionDetails = React.useMemo(() => {
    if (!selectedCollectionId) return [];
    const entry = catalogMap.get(selectedCollectionId);
    return entry ? [entry] : [];
  }, [catalogMap, selectedCollectionId]);

  /** Быстрая таблица соответствий steam-tag → collectionId. */
  const collectionIdByTag = React.useMemo(() => {
    const map = new Map<string, string>();

    for (const entry of steamCollections) {
      if (entry.collectionId) {
        map.set(entry.tag, entry.collectionId);
      }
    }

    for (const entry of Object.values(targetsByCollection)) {
      if (entry.collectionId) {
        map.set(entry.collectionTag, entry.collectionId);
      }
    }

    for (const entry of Object.values(inputsByCollection)) {
      if (entry.collectionId) {
        map.set(entry.collectionTag, entry.collectionId);
      }
    }

    if (selectedCollectionId && activeCollectionTag) {
      map.set(activeCollectionTag, selectedCollectionId);
    }

    return map;
  }, [
    steamCollections,
    targetsByCollection,
    inputsByCollection,
    selectedCollectionId,
    activeCollectionTag,
  ]);

  /** Подтягивает живой список коллекций из Steam Community Market. */
  const loadSteamCollections = React.useCallback(async () => {
    try {
      setSteamCollectionError(null);
      setLoadingSteamCollections(true);
      const steamCollectionList = await fetchSteamCollections();
      setSteamCollections((prev) => {
        if (!prev.length) return steamCollectionList;
        const previousByTag = new Map(prev.map((entry) => [entry.tag, entry] as const));
        return steamCollectionList.map((entry) => {
          const existing = previousByTag.get(entry.tag);
          if (existing?.collectionId && !entry.collectionId) {
            return { ...entry, collectionId: existing.collectionId };
          }
          return entry;
        });
      });
    } catch (error: any) {
      setSteamCollectionError(String(error?.message || error));
    } finally {
      setLoadingSteamCollections(false);
    }
  }, []);

  /**
   * Если для steam-tag выяснился конкретный collectionId — сохраняем его,
   * чтобы переиспользовать в дальнейшем и показывать поддержку float.
   */
  const rememberSteamCollectionId = React.useCallback((collectionTag: string, collectionId: string | null) => {
    if (!collectionTag || !collectionId) return;
    setSteamCollections((prev) => {
      let updated = false;
      const next = prev.map((entry) => {
        if (entry.tag !== collectionTag) return entry;
        if (entry.collectionId === collectionId) {
          updated = true;
          return entry;
        }
        updated = true;
        return { ...entry, collectionId };
      });
      return updated ? next : prev;
    });
  }, []);

  const activeTargets = React.useMemo(() => {
    if (!activeCollectionTag) return [];
    return targetsByCollection[activeCollectionTag]?.targets ?? [];
  }, [activeCollectionTag, targetsByCollection]);

  React.useEffect(() => {
    if (!activeTargets.length) return;
    const missing = new Set<string>();
    for (const target of activeTargets) {
      for (const exterior of target.exteriors) {
        if (exterior.price == null && !targetPriceOverrides[exterior.marketHashName]) {
          missing.add(exterior.marketHashName);
        }
      }
    }
    if (!missing.size) return;

    let cancelled = false;
    async function loadPrices() {
      try {
        const result = await batchPriceOverview(Array.from(missing));
        if (cancelled) return;
        setTargetPriceOverrides((prev) => {
          const next = { ...prev };
          for (const name of Object.keys(result)) {
            const price = result[name];
            if (typeof price === "number") {
              next[name] = price;
            }
          }
          return next;
        });
      } catch (error) {
        console.warn("Failed to fetch target prices", error);
      }
    }

    void loadPrices();
    return () => {
      cancelled = true;
    };
  }, [activeTargets, targetPriceOverrides]);

  /**
   * Выбор коллекции: сбрасывает форму, подгружает цели и при наличии — collectionId из справочника.
   */
  const selectCollection = React.useCallback(
    async (collectionTag: string) => {
      setActiveCollectionTag(collectionTag);
      setTargetsError(null);
      setInputsError(null);
      setSelectedTarget(null);
      setCalculation(null);
      setRows(createInitialRows());
      setCalculationError(null);

      const steamEntry = steamCollections.find((entry) => entry.tag === collectionTag);
      const cachedCollectionId = targetsByCollection[collectionTag]?.collectionId;
      const initialCollectionId = cachedCollectionId ?? steamEntry?.collectionId ?? null;
      setSelectedCollectionId(initialCollectionId ?? null);
      if (initialCollectionId) {
        rememberSteamCollectionId(collectionTag, initialCollectionId);
      }

      if (targetsByCollection[collectionTag]) {
        const cached = targetsByCollection[collectionTag];
        if (cached.collectionId) {
          setSelectedCollectionId(cached.collectionId);
          rememberSteamCollectionId(collectionTag, cached.collectionId);
        }
        return;
      }

      try {
        setLoadingTargets(true);
        const result = await fetchCollectionTargets(collectionTag);
        setTargetsByCollection((prev) => ({ ...prev, [collectionTag]: result }));
        if (result.collectionId) {
          setSelectedCollectionId(result.collectionId);
          rememberSteamCollectionId(collectionTag, result.collectionId);
        }
      } catch (error: any) {
        setTargetsError(String(error?.message || error));
      } finally {
        setLoadingTargets(false);
      }
    },
    [rememberSteamCollectionId, steamCollections, targetsByCollection],
  );

  /** Загружает список Classified-входов и кеширует его по collectionTag. */
  const loadInputsForCollection = React.useCallback(
    async (collectionTag: string) => {
      const cached = inputsByCollection[collectionTag];
      if (cached) {
        setInputsError(null);
        return cached;
      }
      try {
        setInputsLoading(true);
        setInputsError(null);
        const result = await fetchCollectionInputs(collectionTag);
        setInputsByCollection((prev) => ({ ...prev, [collectionTag]: result }));
        return result;
      } catch (error: any) {
        setInputsError(String(error?.message || error));
        throw error;
      } finally {
        setInputsLoading(false);
      }
    },
    [inputsByCollection],
  );

  /** Подтягивает buyer-цены для выбранных market_hash_name и обновляет таблицу. */
  const autofillPrices = React.useCallback(
    async (namesOverride?: string[]) => {
      const lookupNames =
        namesOverride ??
        Array.from(new Set(rows.map((row) => row.marketHashName).filter(Boolean)));
      if (!lookupNames.length) return;
      try {
        setPriceLoading(true);
        const prices = await batchPriceOverview(lookupNames);
        setRows((prev) =>
          prev.map((row) => {
            const price = prices[row.marketHashName];
            if (typeof price === "number") {
              return { ...row, buyerPrice: price.toFixed(2) };
            }
            return row;
          }),
        );
      } catch (error: any) {
        setCalculationError(String(error?.message || error));
      } finally {
        setPriceLoading(false);
      }
    },
    [rows],
  );

  /** Заполняет таблицу входов данными из коллекции и запрашивает цены при необходимости. */
  const applyInputsToRows = React.useCallback(
    async (
      collectionTag: string,
      collectionId: string | null,
      inputs: CollectionInputSummary[],
      options?: {
        target?: {
          exterior: Exterior;
          minFloat?: number | null;
          maxFloat?: number | null;
        };
      },
    ) => {
      const effectiveCollectionValue = buildCollectionSelectValue(
        collectionId ?? selectedCollectionId,
        collectionTag,
      );

      const targetRange = (() => {
        const target = options?.target;
        if (!target) return null;

        const bucket = EXTERIOR_FLOAT_RANGES[target.exterior];
        const clampToBounds = (value: number) => clampFloat(value);

        const resolveCatalogRange = () => {
          if (target.minFloat == null && target.maxFloat == null) return null;
          const min =
            target.minFloat != null ? clampToBounds(target.minFloat) : 0;
          const max =
            target.maxFloat != null ? clampToBounds(target.maxFloat) : 1;
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
      })();

      const desiredFloat = (() => {
        if (targetRange) {
          return clampFloat((targetRange.min + targetRange.max) / 2);
        }
        const target = options?.target;
        if (!target) return null;
        if (target.minFloat != null && target.maxFloat != null && target.maxFloat > target.minFloat) {
          return clampFloat((target.minFloat + target.maxFloat) / 2);
        }
        const midpoint = exteriorMidpoint(target.exterior);
        return midpoint != null ? clampFloat(midpoint) : null;
      })();

      const sortedInputs = (() => {
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
      })();

      const inputsByExterior = sortedInputs.reduce((map, input) => {
        const current = map.get(input.exterior) ?? [];
        current.push(input);
        map.set(input.exterior, current);
        return map;
      }, new Map<Exterior, CollectionInputSummary[]>());

      // Сюда будем складывать 10 предполагаемых входов для таблицы.
      const plannedInputs: CollectionInputSummary[] = [];

      if (targetRange) {
        const projectedBuckets = WEAR_BUCKET_SEQUENCE.map((bucket) => {
          const bucketRange = EXTERIOR_FLOAT_RANGES[bucket.exterior];
          if (!bucketRange) return null;
          const min = Math.max(bucketRange.min, targetRange.min);
          const max = Math.min(bucketRange.max, targetRange.max);
          const width = Math.max(0, max - min);
          const containsPoint =
            targetRange.min === targetRange.max &&
            targetRange.min >= bucketRange.min &&
            targetRange.min <= bucketRange.max;
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
      // Лёгкий offset помогает распределить float вокруг целевого значения.
      const offsetStep = desiredFloat != null && trimmedPlan.length > 1 ? 0.00005 : 0;
      const centerIndex = (trimmedPlan.length - 1) / 2;

      const filledRows: TradeupInputFormRow[] = trimmedPlan.map((input, index) => {
        const bucketRange = EXTERIOR_FLOAT_RANGES[input.exterior] ?? null;
        // Итоговый диапазон для строки — пересечение выбранного таргета и бакета предмета.
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
        const baselineSource =
          desiredFloat ?? rowMidpoint ?? exteriorMidpoint(input.exterior) ?? null;
        const baseline =
          baselineSource == null ? null : clampWithinRowRange(baselineSource);
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
      while (filledRows.length < 10) filledRows.push(makeEmptyRow());
      setRows(filledRows);

      const missingNames = trimmedPlan
        .filter((input) => input.price == null)
        .map((input) => input.marketHashName);
      if (missingNames.length) {
        await autofillPrices(missingNames);
      }
    },
    [autofillPrices, selectedCollectionId],
  );

  /**
   * При выборе конкретного Covert-результата подбираем входы коллекции и фиксируем активную цель.
   */
  const selectTarget = React.useCallback(
    async (
      collectionTag: string,
      baseName: string,
      exterior: CollectionTargetExterior,
    ) => {
      setSelectedTarget({
        collectionTag,
        baseName,
        exterior: exterior.exterior,
        marketHashName: exterior.marketHashName,
        minFloat: exterior.minFloat,
        maxFloat: exterior.maxFloat,
        price: exterior.price ?? null,
      });
      setCalculation(null);
      setCalculationError(null);
      try {
        const response = await loadInputsForCollection(collectionTag);
        const resolvedCollectionId =
          response.collectionId ??
          targetsByCollection[collectionTag]?.collectionId ??
          steamCollections.find((entry) => entry.tag === collectionTag)?.collectionId ??
          catalogCollections.find((collection) =>
            collection.covert.some((covert) => covert.baseName === baseName),
          )?.id ??
          selectedCollectionId ??
          null;

        if (resolvedCollectionId) {
          setSelectedCollectionId(resolvedCollectionId);
          rememberSteamCollectionId(collectionTag, resolvedCollectionId);
          setTargetsByCollection((prev) => {
            const current = prev[collectionTag];
            if (!current || current.collectionId === resolvedCollectionId) return prev;
            return { ...prev, [collectionTag]: { ...current, collectionId: resolvedCollectionId } };
          });
          setInputsByCollection((prev) => {
            const current = prev[collectionTag];
            if (!current || current.collectionId === resolvedCollectionId) return prev;
            return { ...prev, [collectionTag]: { ...current, collectionId: resolvedCollectionId } };
          });
        }

        await applyInputsToRows(collectionTag, resolvedCollectionId, response.inputs, {
          target: {
            exterior: exterior.exterior,
            minFloat: exterior.minFloat ?? null,
            maxFloat: exterior.maxFloat ?? null,
          },
        });
      } catch (error) {
        // handled in loadInputsForCollection
      }
    },
    [
      applyInputsToRows,
      catalogCollections,
      loadInputsForCollection,
      rememberSteamCollectionId,
      selectedCollectionId,
      steamCollections,
      targetsByCollection,
    ],
  );

  /** Позволяет редактировать одну строку таблицы вручную. */
  const updateRow = React.useCallback(
    (index: number, patch: Partial<TradeupInputFormRow>) => {
      setRows((prev) => {
        const next = prev.slice();
        next[index] = { ...next[index], ...patch };
        return next;
      });
    },
  []);

  /** Приводим строки формы к числовому виду и фильтруем пустые значения. */
  const parsedRows = React.useMemo(() => {
    return rows
      .map((row) => ({
        marketHashName: row.marketHashName.trim(),
        collectionId: row.collectionId.trim(),
        float: Number.parseFloat(row.float),
        buyerPrice: Number.parseFloat(row.buyerPrice),
      }))
      .filter((row) => row.marketHashName && Number.isFinite(row.float));
  }, [rows]);

  const rowResolution = React.useMemo<RowResolution>(() => {
    if (!parsedRows.length) {
      return {
        rows: [],
        unresolvedNames: [],
        hasMultipleCollections: false,
        resolvedCollectionId: selectedCollectionId ?? null,
        collectionCounts: new Map(),
      };
    }

    const rowsWithResolved: ResolvedTradeupRow[] = parsedRows.map((row) => {
      const meta = collectionValueMeta.get(row.collectionId);
      const fallbackTag = meta?.tag ?? readTagFromCollectionValue(row.collectionId);
      const steamEntry = fallbackTag ? steamCollectionsByTag.get(fallbackTag) : undefined;

      let resolvedId = meta?.collectionId ?? null;
      let resolvedName = meta?.name ?? steamEntry?.name ?? null;

      if (!resolvedId && row.collectionId && catalogMap.has(row.collectionId)) {
        resolvedId = row.collectionId;
      }

      if (!resolvedId && fallbackTag) {
        const cachedByTag = collectionIdByTag.get(fallbackTag);
        if (cachedByTag) {
          resolvedId = cachedByTag;
        }
      }

      if (!resolvedId && steamEntry?.collectionId) {
        resolvedId = steamEntry.collectionId;
      }

      if (!resolvedId && selectedCollectionId) {
        resolvedId = selectedCollectionId;
      }

      if (!resolvedId && row.collectionId) {
        resolvedId = row.collectionId;
      }

      if (!resolvedName && resolvedId) {
        resolvedName = catalogMap.get(resolvedId)?.name ?? resolvedName;
      }

      if (!resolvedName && steamEntry?.name) {
        resolvedName = steamEntry.name;
      }

      return {
        ...row,
        resolvedCollectionId: resolvedId,
        resolvedCollectionName: resolvedName,
        resolvedTag: fallbackTag,
      };
    });

    const unresolvedRows = rowsWithResolved.filter((row) => !row.resolvedCollectionId);
    const unresolvedNames = Array.from(
      new Set(
        unresolvedRows.map((row) => row.resolvedCollectionName ?? row.collectionId ?? "неизвестно"),
      ),
    );

    const collectionCounts = new Map<string, number>();
    for (const row of rowsWithResolved) {
      if (!row.resolvedCollectionId) continue;
      collectionCounts.set(
        row.resolvedCollectionId,
        (collectionCounts.get(row.resolvedCollectionId) ?? 0) + 1,
      );
    }

    const resolvedIds = Array.from(collectionCounts.keys());
    const hasMultipleCollections = resolvedIds.length > 1;

    let resolvedCollectionId = selectedCollectionId ?? null;
    if (!resolvedCollectionId && resolvedIds.length === 1) {
      [resolvedCollectionId] = resolvedIds;
    }

    return {
      rows: rowsWithResolved,
      unresolvedNames,
      hasMultipleCollections,
      resolvedCollectionId,
      collectionCounts,
    };
  }, [
    parsedRows,
    catalogMap,
    collectionIdByTag,
    collectionValueMeta,
    selectedCollectionId,
    steamCollectionsByTag,
  ]);

  /** Средний float по заполненным слотам. */
  const averageFloat = React.useMemo(() => {
    if (!parsedRows.length) return 0;
    const sum = parsedRows.reduce((acc, row) => acc + row.float, 0);
    return sum / parsedRows.length;
  }, [parsedRows]);

  /** Суммарная стоимость в buyer-ценах. */
  const totalBuyerCost = React.useMemo(() => {
    return parsedRows.reduce(
      (sum, row) => sum + (Number.isFinite(row.buyerPrice) ? row.buyerPrice : 0),
      0,
    );
  }, [parsedRows]);

  const totalNetCost = totalBuyerCost / buyerToNetRate;

  /**
   * Проводит расчёт «без float»: оценивает диапазон входов и возможные исходы по wear.
   * Возвращает как консервативные, так и ожидаемые метрики доходности.
   */
  const floatlessAnalysis = React.useMemo<FloatlessAnalysisResult>(() => {
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

    const wearSlots = rowResolution.rows.map((row) => {
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

    const validSlots = wearSlots.filter((slot): slot is { exterior: Exterior; bucket: { min: number; max: number } } =>
      Boolean(slot),
    );
    const totalSlots = validSlots.length;
    const minSum = validSlots.reduce((sum, slot) => sum + slot.bucket.min, 0);
    const maxSum = validSlots.reduce((sum, slot) => sum + slot.bucket.max, 0);
    const inputRange = {
      min: clampFloat(minSum / Math.max(totalSlots, 1)),
      max: clampFloat(maxSum / Math.max(totalSlots, 1)),
    };

    const collectionProbability = rowResolution.rows.length
      ? (rowResolution.collectionCounts.get(resolvedCollectionId) ?? 0) /
        rowResolution.rows.length
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
        const fallback = catalogEntry?.covert.find((entry) => entry.baseName === target.baseName);
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
          rangeWidth === 0 && normalizedMin >= bucket.min && normalizedMin <= bucket.max;
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
      }).filter((entry): entry is NonNullable<typeof entry> => entry != null);

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
  }, [
    activeTargets,
    buyerToNetRate,
    catalogMap,
    rowResolution,
    targetPriceOverrides,
    totalNetCost,
    selectedTarget,
  ]);

  /**
   * Отправляет форму на сервер. Перед вызовом проверяем, что заполнено 10 корректных входов.
   */
  const calculate = React.useCallback(async () => {
    if (parsedRows.length === 0) {
      setCalculationError("Нужно добавить хотя бы один вход");
      return;
    }
    if (parsedRows.length !== 10) {
      setCalculationError("Trade-up требует ровно 10 входов");
      return;
    }

    if (rowResolution.unresolvedNames.length) {
      setCalculationError(
        `Не удалось определить коллекцию для: ${rowResolution.unresolvedNames
          .map((name) => `"${name}"`)
          .join(", ")}`,
      );
      return;
    }

    if (rowResolution.hasMultipleCollections) {
      setCalculationError("Trade-up должен использовать предметы из одной коллекции");
      return;
    }

    const resolvedCollectionId = rowResolution.resolvedCollectionId;

    if (!resolvedCollectionId) {
      setCalculationError("Не удалось определить коллекцию для trade-up");
      return;
    }

    setSelectedCollectionId(resolvedCollectionId);
    if (activeCollectionTag) {
      rememberSteamCollectionId(activeCollectionTag, resolvedCollectionId);
    }

    setCalculating(true);
    setCalculationError(null);
    try {
      const targetOverrides =
        selectedTarget && resolvedCollectionId
          ? [
              {
                collectionId: resolvedCollectionId,
                collectionTag: selectedTarget.collectionTag,
                baseName: selectedTarget.baseName,
                exterior: selectedTarget.exterior,
                marketHashName: selectedTarget.marketHashName,
                minFloat: selectedTarget.minFloat ?? null,
                maxFloat: selectedTarget.maxFloat ?? null,
                price: selectedTarget.price ?? null,
              },
            ]
          : undefined;
      const payload = {
        inputs: rowResolution.rows.map((row) => ({
          marketHashName: row.marketHashName,
          float: row.float,
          collectionId: row.resolvedCollectionId ?? resolvedCollectionId,
          priceOverrideNet: Number.isFinite(row.buyerPrice)
            ? row.buyerPrice / buyerToNetRate
            : undefined,
        })),
        targetCollectionIds: [resolvedCollectionId],
        options: { buyerToNetRate },
        targetOverrides,
      };
      const result = await requestTradeupCalculation(payload);
      setCalculation(result);
    } catch (error: any) {
      setCalculation(null);
      setCalculationError(String(error?.message || error));
    } finally {
      setCalculating(false);
    }
  }, [
    activeCollectionTag,
    buyerToNetRate,
    rememberSteamCollectionId,
    rowResolution,
    selectedTarget,
  ]);

  return {
    catalogCollections,
    steamCollections,
    collectionOptions,
    loadSteamCollections,
    loadingSteamCollections,
    steamCollectionError,
    activeCollectionTag,
    selectCollection,
    collectionTargets: activeTargets,
    loadingTargets,
    targetsError,
    selectedTarget,
    selectTarget,
    inputsLoading,
    inputsError,
    rows,
    updateRow,
    buyerFeePercent,
    setBuyerFeePercent,
    buyerToNetRate,
    averageFloat,
    totalBuyerCost,
    totalNetCost,
    selectedCollectionDetails,
    autofillPrices,
    priceLoading,
    calculate,
    calculation,
    calculating,
    calculationError,
    floatlessAnalysis,
  };
}
