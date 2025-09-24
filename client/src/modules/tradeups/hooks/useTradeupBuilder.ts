import React from "react";
import type { Exterior } from "../../skins/services/types";
import {
  batchPriceOverview,
  fetchCollectionInputs,
  fetchCollectionTargets,
  fetchSteamCollections,
  fetchTradeupCollections,
  requestTradeupCalculation,
  type CollectionInputSummary,
  type CollectionInputsResponse,
  type CollectionTargetExterior,
  type CollectionTargetSummary,
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

const TRADEUP_SLOT_COUNT = 10;
const BUDGET_RESERVE_FRACTION = 0.1;

const makeEmptyRow = (): TradeupInputFormRow => ({
  marketHashName: "",
  collectionId: "",
  float: "",
  buyerPrice: "",
});

const createInitialRows = () => Array.from({ length: TRADEUP_SLOT_COUNT }, makeEmptyRow);

const EXTERIOR_FLOAT_RANGES: Record<Exterior, { min: number; max: number }> = {
  "Factory New": { min: 0, max: 0.07 },
  "Minimal Wear": { min: 0.07, max: 0.15 },
  "Field-Tested": { min: 0.15, max: 0.38 },
  "Well-Worn": { min: 0.38, max: 0.45 },
  "Battle-Scarred": { min: 0.45, max: 1 },
};

const clampFloat = (value: number) => Math.min(1, Math.max(0, value));

interface FloatRange {
  min: number;
  max: number;
}

interface AverageFloatFeasibility {
  feasible: boolean;
  range: FloatRange | null;
}

interface SlotBudgetCap {
  totalNet: number;
  perSlotNet: number;
  perSlotBuyer: number;
}

const computeAverageFloatFeasibility = (options: {
  targets: CollectionTargetSummary[];
  exterior: Exterior;
  fallbackCollection?: TradeupCollection | null;
}): AverageFloatFeasibility => {
  const wearBucket = EXTERIOR_FLOAT_RANGES[options.exterior];
  if (!wearBucket) {
    return { feasible: false, range: null };
  }

  let intersection: FloatRange = { min: 0, max: 1 };
  let hasValidRange = false;

  for (const target of options.targets) {
    const exteriorEntry = target.exteriors.find(
      (entry: CollectionTargetExterior) => entry.exterior === options.exterior,
    );
    if (!exteriorEntry) {
      return { feasible: false, range: null };
    }

    const fallback = options.fallbackCollection?.covert.find(
      (entry) => entry.baseName === target.baseName,
    );
    const minFloat = exteriorEntry.minFloat ?? fallback?.minFloat;
    const maxFloat = exteriorEntry.maxFloat ?? fallback?.maxFloat;

    if (minFloat == null || maxFloat == null || maxFloat <= minFloat) {
      continue;
    }

    const span = maxFloat - minFloat;
    const normalizedMin = clampFloat((wearBucket.min - minFloat) / span);
    const normalizedMax = clampFloat((wearBucket.max - minFloat) / span);

    const range: FloatRange = {
      min: Math.min(normalizedMin, normalizedMax),
      max: Math.max(normalizedMin, normalizedMax),
    };

    const nextMin = Math.max(intersection.min, range.min);
    const nextMax = Math.min(intersection.max, range.max);
    if (nextMin > nextMax) {
      return { feasible: false, range: null };
    }

    intersection = { min: nextMin, max: nextMax };
    hasValidRange = true;
  }

  if (!hasValidRange) {
    return { feasible: true, range: null };
  }

  return { feasible: true, range: intersection };
};

const computeSlotBudgetCap = (options: {
  targets: CollectionTargetSummary[];
  exterior: Exterior;
  buyerToNetRate: number;
  reserveFraction?: number;
}): SlotBudgetCap | null => {
  const reserveFraction = options.reserveFraction ?? BUDGET_RESERVE_FRACTION;
  const relevantPrices = options.targets
    .map((target) =>
      target.exteriors.find(
        (entry: CollectionTargetExterior) => entry.exterior === options.exterior,
      ),
    )
    .filter(
      (entry): entry is CollectionTargetExterior & { price: number } =>
        Boolean(entry && typeof entry.price === "number"),
    )
    .map((entry) => entry.price);

  if (!relevantPrices.length) {
    return null;
  }

  const averageBuyer =
    relevantPrices.reduce((sum, price) => sum + price, 0) / relevantPrices.length;
  const averageNet = averageBuyer / options.buyerToNetRate;
  const reserveMultiplier = reserveFraction >= 1 ? 0 : Math.max(0, 1 - reserveFraction);
  const totalNet = averageNet * reserveMultiplier;
  const perSlotNet = totalNet / TRADEUP_SLOT_COUNT;
  const perSlotBuyer = perSlotNet * options.buyerToNetRate;

  return { totalNet, perSlotNet, perSlotBuyer };
};

const exteriorMidpoint = (exterior: Exterior) => {
  const range = EXTERIOR_FLOAT_RANGES[exterior];
  if (!range) return null;
  return (range.min + range.max) / 2;
};

const formatFloatValue = (value: number | null | undefined) =>
  value == null ? "" : clampFloat(value).toFixed(5);

const STEAM_TAG_VALUE_PREFIX = "steam-tag:";

interface CollectionSelectOption {
  value: string;
  label: string;
  supported: boolean;
}

const buildCollectionSelectValue = (
  collectionId?: string | null,
  collectionTag?: string | null,
) => {
  if (collectionId) return collectionId;
  if (collectionTag) return `${STEAM_TAG_VALUE_PREFIX}${collectionTag}`;
  return "";
};

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
  collectionId?: string | null;
  minFloat?: number;
  maxFloat?: number;
  price?: number | null;
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
    Record<string, CollectionInputsResponse>
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

  const catalogMap = React.useMemo(() => {
    return new Map(catalogCollections.map((collection) => [collection.id, collection] as const));
  }, [catalogCollections]);

  const steamCollectionsByTag = React.useMemo(
    () => new Map(steamCollections.map((entry) => [entry.tag, entry] as const)),
    [steamCollections],
  );

  const collectionValueMeta = React.useMemo(() => {
    const meta = new Map<string, CollectionValueMeta>();

    const register = (value: string, details: { collectionId: string | null; tag: string | null; name?: string | null }) => {
      if (!value) return;

      const existing = meta.get(value);
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
        meta.set(value, next);
        return;
      }

      const hasBetterId = !existing.collectionId && next.collectionId;
      const hasBetterName = !existing.name && next.name;
      if (hasBetterId || hasBetterName) {
        meta.set(value, {
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
      if (!meta.has(entry.id)) {
        register(entry.id, { collectionId: entry.id, tag: null, name: entry.name });
      }
    }

    return meta;
  }, [
    steamCollections,
    steamCollectionsByTag,
    targetsByCollection,
    inputsByCollection,
    catalogCollections,
    catalogMap,
  ]);

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

  const selectedCollectionDetails = React.useMemo(() => {
    if (!selectedCollectionId) return [];
    const entry = catalogMap.get(selectedCollectionId);
    return entry ? [entry] : [];
  }, [catalogMap, selectedCollectionId]);

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

  const resolveTargetPlanning = React.useCallback(
    (collectionTag: string, desiredExterior: Exterior, resolvedCollectionId: string | null) => {
      const targetsEntry = targetsByCollection[collectionTag];
      if (!targetsEntry) return null;

      const effectiveCollectionId = resolvedCollectionId ?? targetsEntry.collectionId ?? null;
      const fallbackCollection =
        effectiveCollectionId != null ? catalogMap.get(effectiveCollectionId) ?? null : null;

      const feasibility = computeAverageFloatFeasibility({
        targets: targetsEntry.targets,
        exterior: desiredExterior,
        fallbackCollection,
      });

      const budget = computeSlotBudgetCap({
        targets: targetsEntry.targets,
        exterior: desiredExterior,
        buyerToNetRate,
        reserveFraction: BUDGET_RESERVE_FRACTION,
      });

      return {
        feasibility,
        budget,
        collectionId: effectiveCollectionId,
      };
    },
    [targetsByCollection, catalogMap, buyerToNetRate],
  );

  /** Подтягивает живой список коллекций из Steam Community Market. */
  const loadSteamCollections = React.useCallback(async () => {
    try {
      setSteamCollectionError(null);
      setLoadingSteamCollections(true);
      const list = await fetchSteamCollections();
      setSteamCollections((prev) => {
        if (!prev.length) return list;
        const previousByTag = new Map(prev.map((entry) => [entry.tag, entry] as const));
        return list.map((entry) => {
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
        slotBuyerCap?: number | null;
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

      const sortedInputs = desiredFloat != null
        ? [...inputs].sort((a, b) => {
            const aMid = exteriorMidpoint(a.exterior) ?? desiredFloat;
            const bMid = exteriorMidpoint(b.exterior) ?? desiredFloat;
            const diff = Math.abs(aMid - desiredFloat) - Math.abs(bMid - desiredFloat);
            if (diff !== 0) return diff;
            return a.marketHashName.localeCompare(b.marketHashName, "ru");
          })
        : inputs;

      const slotBuyerCap = options?.slotBuyerCap ?? null;
      const filteredInputs =
        slotBuyerCap != null
          ? sortedInputs.filter((entry) => entry.price == null || entry.price <= slotBuyerCap)
          : sortedInputs;

      if (slotBuyerCap != null && filteredInputs.length === 0) {
        setInputsError(
          `В коллекции нет входов дешевле $${slotBuyerCap.toFixed(2)}. Попробуйте снизить требования или увеличить бюджет.`,
        );
        setRows(createInitialRows());
        return;
      }

      const trimmed = filteredInputs.slice(0, TRADEUP_SLOT_COUNT);
      const offsetStep = desiredFloat != null && trimmed.length > 1 ? 0.00005 : 0;
      const centerIndex = (trimmed.length - 1) / 2;
      const clampWithinTargetRange = (value: number) => {
        if (!targetRange) return clampFloat(value);
        if (value < targetRange.min) return clampFloat(targetRange.min);
        if (value > targetRange.max) return clampFloat(targetRange.max);
        return clampFloat(value);
      };

      if (slotBuyerCap != null) {
        if (trimmed.length < TRADEUP_SLOT_COUNT) {
          setInputsError(
            `Найдено только ${trimmed.length} входов дешевле $${slotBuyerCap.toFixed(
              2,
            )}. Остальные слоты заполните вручную.`,
          );
        } else {
          setInputsError(null);
        }
      } else {
        setInputsError(null);
      }

      const filled: TradeupInputFormRow[] = trimmed.map((input, index) => {
        const baselineRaw = desiredFloat ?? exteriorMidpoint(input.exterior) ?? null;
        const baseline = baselineRaw == null ? null : clampWithinTargetRange(baselineRaw);
        const adjusted =
          baseline == null
            ? null
            : clampWithinTargetRange(baseline + offsetStep * (index - centerIndex));
        return {
          marketHashName: input.marketHashName,
          collectionId: effectiveCollectionValue,
          float: formatFloatValue(adjusted),
          buyerPrice: input.price != null ? input.price.toFixed(2) : "",
        };
      });
      while (filled.length < TRADEUP_SLOT_COUNT) filled.push(makeEmptyRow());
      setRows(filled);

      const missingNames = trimmed
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
        collectionId: null,
        minFloat: exterior.minFloat,
        maxFloat: exterior.maxFloat,
        price: exterior.price ?? null,
      });
      setInputsError(null);
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

        const planning = resolveTargetPlanning(collectionTag, exterior.exterior, resolvedCollectionId);
        const targetCollectionId = resolvedCollectionId ?? planning?.collectionId ?? null;

        setSelectedTarget((prev) => {
          if (!prev || prev.marketHashName !== exterior.marketHashName) return prev;
          return { ...prev, collectionId: targetCollectionId };
        });

        if (targetCollectionId) {
          setSelectedCollectionId(targetCollectionId);
          rememberSteamCollectionId(collectionTag, targetCollectionId);
          setTargetsByCollection((prev) => {
            const current = prev[collectionTag];
            if (!current || current.collectionId === targetCollectionId) return prev;
            return { ...prev, [collectionTag]: { ...current, collectionId: targetCollectionId } };
          });
          setInputsByCollection((prev) => {
            const current = prev[collectionTag];
            if (!current || current.collectionId === targetCollectionId) return prev;
            return { ...prev, [collectionTag]: { ...current, collectionId: targetCollectionId } };
          });
        }

        if (planning && !planning.feasibility.feasible) {
          setInputsError(
            "Выбранный экстерьер недостижим для всех Covert-исходов. Измените цель или состав входов.",
          );
          setRows(createInitialRows());
          return;
        }

        await applyInputsToRows(collectionTag, targetCollectionId, response.inputs, {
          target: {
            exterior: exterior.exterior,
            minFloat: exterior.minFloat ?? null,
            maxFloat: exterior.maxFloat ?? null,
          },
          slotBuyerCap: planning?.budget?.perSlotBuyer ?? null,
        });
      } catch (error) {
        // handled in loadInputsForCollection
      }
    },
    [
      applyInputsToRows,
      catalogCollections,
      resolveTargetPlanning,
      loadInputsForCollection,
      rememberSteamCollectionId,
      selectedCollectionId,
      steamCollections,
      targetsByCollection,
    ],
  );

  const selectedTargetPlanning = React.useMemo(() => {
    if (!selectedTarget) return null;
    const fallbackCollectionId = selectedTarget.collectionId ?? selectedCollectionId ?? null;
    return resolveTargetPlanning(selectedTarget.collectionTag, selectedTarget.exterior, fallbackCollectionId);
  }, [
    resolveTargetPlanning,
    selectedCollectionId,
    selectedTarget,
  ]);

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

    const rowsWithResolved = parsedRows.map((row) => {
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
    if (unresolvedRows.length) {
      const uniqueNames = Array.from(
        new Set(
          unresolvedRows.map(
            (row) => row.resolvedCollectionName ?? row.collectionId ?? "неизвестно",
          ),
        ),
      );
      setCalculationError(
        `Не удалось определить коллекцию для: ${uniqueNames
          .map((name) => `"${name}"`)
          .join(", ")}`,
      );
      return;
    }

    const rowCollectionIds = new Set(
      rowsWithResolved
        .map((row) => row.resolvedCollectionId)
        .filter((value): value is string => Boolean(value)),
    );

    if (rowCollectionIds.size > 1) {
      setCalculationError("Trade-up должен использовать предметы из одной коллекции");
      return;
    }

    const [singleCollectionId] = rowCollectionIds.size === 1 ? Array.from(rowCollectionIds) : [];
    const resolvedCollectionId = selectedCollectionId ?? singleCollectionId ?? null;

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
        inputs: rowsWithResolved.map((row) => ({
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
    catalogMap,
    collectionValueMeta,
    collectionIdByTag,
    parsedRows,
    rememberSteamCollectionId,
    selectedCollectionId,
    selectedTarget,
    steamCollectionsByTag,
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
    selectedTargetPlanning,
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
  };
}
