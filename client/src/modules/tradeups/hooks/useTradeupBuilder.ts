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

const makeEmptyRow = (): TradeupInputFormRow => ({
  marketHashName: "",
  collectionId: "",
  float: "",
  buyerPrice: "",
});

const createInitialRows = () => Array.from({ length: 10 }, makeEmptyRow);

const EXTERIOR_FLOAT_RANGES: Record<Exterior, { min: number; max: number }> = {
  "Factory New": { min: 0, max: 0.07 },
  "Minimal Wear": { min: 0.07, max: 0.15 },
  "Field-Tested": { min: 0.15, max: 0.38 },
  "Well-Worn": { min: 0.38, max: 0.45 },
  "Battle-Scarred": { min: 0.45, max: 1 },
};

const STEAM_TAG_VALUE_PREFIX = "steam-tag:";

interface CollectionSelectOption {
  value: string;
  label: string;
  supported: boolean;
}

/** Возвращает типовой float для выбранного износа (центр диапазона). */
const defaultFloatForExterior = (exterior: Exterior) => {
  const range = EXTERIOR_FLOAT_RANGES[exterior];
  if (!range) return "";
  const midpoint = (range.min + range.max) / 2;
  return midpoint.toFixed(5);
};

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
  minFloat?: number;
  maxFloat?: number;
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
    Record<string, { collectionId: string | null; inputs: CollectionInputSummary[] }>
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
    async (collectionTag: string, collectionId: string | null, inputs: CollectionInputSummary[]) => {
      const effectiveCollectionValue = buildCollectionSelectValue(
        collectionId ?? selectedCollectionId,
        collectionTag,
      );
      const trimmed = inputs.slice(0, 10);
      const filled: TradeupInputFormRow[] = trimmed.map((input) => ({
        marketHashName: input.marketHashName,
        collectionId: effectiveCollectionValue,
        float: defaultFloatForExterior(input.exterior),
        buyerPrice: input.price != null ? input.price.toFixed(2) : "",
      }));
      while (filled.length < 10) filled.push(makeEmptyRow());
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
        minFloat: exterior.minFloat,
        maxFloat: exterior.maxFloat,
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

        await applyInputsToRows(collectionTag, resolvedCollectionId, response.inputs);
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
