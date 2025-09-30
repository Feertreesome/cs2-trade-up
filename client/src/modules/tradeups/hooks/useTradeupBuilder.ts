import React from "react";
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
  type CollectionTargetsResponse,
  type SteamCollectionSummary,
  type TargetRarity,
  type TradeupCalculationResponse,
  type TradeupCollection,
} from "../services/api";
import {
  buildCollectionSelectValue,
  createInitialRows,
  readTagFromCollectionValue,
} from "./helpers";
import { evaluateFloatlessTradeup } from "./floatlessAnalysis";
import { planRowsForCollection } from "./rowPlanning";
import { resolveTradeupRows } from "./rowResolution";
import type {
  CollectionSelectOption,
  CollectionValueMeta,
  FloatlessAnalysisResult,
  ParsedTradeupRow,
  RowResolution,
  SelectedTarget,
  TradeupInputFormRow,
} from "./types";

export type {
  TradeupInputFormRow,
  CollectionSelectOption,
  SelectedTarget,
  FloatlessOutcomeExterior,
  FloatlessOutcomeSummary,
  FloatlessAnalysisResult,
} from "./types";

/**
 * Хук инкапсулирует весь state и бизнес-логику для TradeupBuilder:
 * загрузку справочников, выбор целей, управление входами и отправку расчёта на сервер.
 */

export default function useTradeupBuilder() {
  const [catalogCollections, setCatalogCollections] = React.useState<TradeupCollection[]>([]);
  const [steamCollections, setSteamCollections] = React.useState<SteamCollectionSummary[]>([]);
  const [loadingSteamCollections, setLoadingSteamCollections] = React.useState(false);
  const [steamCollectionError, setSteamCollectionError] = React.useState<string | null>(null);

  const [activeCollectionTag, setActiveCollectionTag] = React.useState<string | null>(null);
  const [targetRarity, setTargetRarityState] = React.useState<TargetRarity>("Covert");
  const [targetsByCollection, setTargetsByCollection] = React.useState<
    Record<string, Partial<Record<TargetRarity, CollectionTargetsResponse>>>
  >({});
  const [loadingTargets, setLoadingTargets] = React.useState(false);
  const [targetsError, setTargetsError] = React.useState<string | null>(null);

  const [inputsByCollection, setInputsByCollection] = React.useState<
    Record<string, Partial<Record<TargetRarity, CollectionInputsResponse>>>
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

  const targetCacheResponses = React.useMemo(
    () =>
      Object.values(targetsByCollection).flatMap((entry) =>
        Object.values(entry ?? {}).filter(Boolean) as CollectionTargetsResponse[],
      ),
    [targetsByCollection],
  );

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

    for (const entry of targetCacheResponses) {
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

    Object.values(inputsByCollection).forEach((entryByRarity) => {
      Object.values(entryByRarity ?? {}).forEach((entry) => {
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
      });
    });

    for (const entry of catalogCollections) {
      if (!valueMetaMap.has(entry.id)) {
        register(entry.id, { collectionId: entry.id, tag: null, name: entry.name });
      }
    }

    return valueMetaMap;
  }, [
    steamCollections,
    steamCollectionsByTag,
    targetCacheResponses,
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

    for (const entry of targetCacheResponses) {
      if (entry.collectionId) {
        map.set(entry.collectionTag, entry.collectionId);
      }
    }

    Object.values(inputsByCollection).forEach((entryByRarity) => {
      Object.values(entryByRarity ?? {}).forEach((entry) => {
        if (entry.collectionId) {
          map.set(entry.collectionTag, entry.collectionId);
        }
      });
    });

    if (selectedCollectionId && activeCollectionTag) {
      map.set(activeCollectionTag, selectedCollectionId);
    }

    return map;
  }, [
    steamCollections,
    targetCacheResponses,
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
    return targetsByCollection[activeCollectionTag]?.[targetRarity]?.targets ?? [];
  }, [activeCollectionTag, targetRarity, targetsByCollection]);

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

  const setTargetRarity = React.useCallback(
    (rarity: TargetRarity) => {
      if (rarity === targetRarity) return;
      setTargetRarityState(rarity);
      setTargetsError(null);
      setSelectedTarget(null);
      setCalculation(null);
      if (!activeCollectionTag) return;
      const cached = targetsByCollection[activeCollectionTag]?.[rarity];
      if (cached) {
        if (cached.collectionId) {
          setSelectedCollectionId(cached.collectionId);
          rememberSteamCollectionId(activeCollectionTag, cached.collectionId);
        }
        return;
      }
      setLoadingTargets(true);
      (async () => {
        try {
          const result = await fetchCollectionTargets(activeCollectionTag, rarity);
          setTargetsByCollection((prev) => ({
            ...prev,
            [activeCollectionTag]: { ...(prev[activeCollectionTag] ?? {}), [rarity]: result },
          }));
          if (result.collectionId) {
            setSelectedCollectionId(result.collectionId);
            rememberSteamCollectionId(activeCollectionTag, result.collectionId);
          }
        } catch (error: any) {
          setTargetsError(String(error?.message || error));
        } finally {
          setLoadingTargets(false);
        }
      })();
    },
    [
      activeCollectionTag,
      rememberSteamCollectionId,
      targetRarity,
      targetsByCollection,
    ],
  );

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
      const cachedByRarity = targetsByCollection[collectionTag];
      const cachedForSelectedRarity = cachedByRarity?.[targetRarity];
      const fallbackCached = cachedByRarity
        ? (Object.values(cachedByRarity).find((entry) => entry?.collectionId) as
            | CollectionTargetsResponse
            | undefined)
        : undefined;
      const initialCollectionId =
        cachedForSelectedRarity?.collectionId ??
        fallbackCached?.collectionId ??
        steamEntry?.collectionId ??
        null;
      setSelectedCollectionId(initialCollectionId ?? null);
      if (initialCollectionId) {
        rememberSteamCollectionId(collectionTag, initialCollectionId);
      }

      if (cachedForSelectedRarity) {
        if (cachedForSelectedRarity.collectionId) {
          setSelectedCollectionId(cachedForSelectedRarity.collectionId);
          rememberSteamCollectionId(collectionTag, cachedForSelectedRarity.collectionId);
        }
        return;
      }

      try {
        setLoadingTargets(true);
        const result = await fetchCollectionTargets(collectionTag, targetRarity);
        setTargetsByCollection((prev) => ({
          ...prev,
          [collectionTag]: { ...(prev[collectionTag] ?? {}), [targetRarity]: result },
        }));
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
    [rememberSteamCollectionId, steamCollections, targetRarity, targetsByCollection],
  );

  /** Загружает список входов и кеширует его по collectionTag и редкости цели. */
  const loadInputsForCollection = React.useCallback(
    async (collectionTag: string, rarity: TargetRarity) => {
      const cached = inputsByCollection[collectionTag]?.[rarity];
      if (cached) {
        setInputsError(null);
        return cached;
      }
      try {
        setInputsLoading(true);
        setInputsError(null);
        const result = await fetchCollectionInputs(collectionTag, rarity);
        setInputsByCollection((prev) => ({
          ...prev,
          [collectionTag]: { ...(prev[collectionTag] ?? {}), [rarity]: result },
        }));
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
          exterior: CollectionTargetExterior["exterior"];
          minFloat?: number | null;
          maxFloat?: number | null;
        };
      },
    ) => {
      const { rows: plannedRows, missingNames } = planRowsForCollection({
        collectionTag,
        collectionId,
        selectedCollectionId,
        inputs,
        options,
      });

      setRows(plannedRows);

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
        const response = await loadInputsForCollection(collectionTag, targetRarity);
        const cachedTargets = targetsByCollection[collectionTag];
        const cachedCollectionId = cachedTargets
          ? cachedTargets[targetRarity]?.collectionId ??
            ((Object.values(cachedTargets).find((entry) => entry?.collectionId) as
              | CollectionTargetsResponse
              | undefined)
              ?.collectionId ?? null)
          : null;
        const resolvedCollectionId =
          response.collectionId ??
          cachedCollectionId ??
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
            if (!current) return prev;
            let changed = false;
            const updated: Partial<Record<TargetRarity, CollectionTargetsResponse>> = {};
            (Object.entries(current) as [TargetRarity, CollectionTargetsResponse | undefined][]).forEach(
              ([rarityKey, entry]) => {
                if (!entry) return;
                if (entry.collectionId === resolvedCollectionId) {
                  updated[rarityKey] = entry;
                  return;
                }
                updated[rarityKey] = { ...entry, collectionId: resolvedCollectionId };
                changed = true;
              },
            );
            if (!changed) return prev;
            return { ...prev, [collectionTag]: { ...current, ...updated } };
          });
          setInputsByCollection((prev) => {
            const current = prev[collectionTag];
            if (!current) return prev;
            let changed = false;
            const updated: Partial<Record<TargetRarity, CollectionInputsResponse>> = {};
            (Object.entries(current) as [TargetRarity, CollectionInputsResponse | undefined][]).forEach(
              ([rarityKey, entry]) => {
                if (!entry) return;
                if (entry.collectionId === resolvedCollectionId) {
                  updated[rarityKey] = entry;
                  return;
                }
                updated[rarityKey] = { ...entry, collectionId: resolvedCollectionId };
                changed = true;
              },
            );
            if (!changed) return prev;
            return { ...prev, [collectionTag]: { ...current, ...updated } };
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
      targetRarity,
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
    return resolveTradeupRows({
      parsedRows,
      selectedCollectionId,
      collectionValueMeta,
      steamCollectionsByTag,
      catalogMap,
      collectionIdByTag,
    });
  }, [
    parsedRows,
    collectionIdByTag,
    collectionValueMeta,
    selectedCollectionId,
    steamCollectionsByTag,
    catalogMap,
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
    return evaluateFloatlessTradeup({
      rowResolution,
      activeTargets,
      catalogMap,
      selectedTarget,
      targetPriceOverrides,
      buyerToNetRate,
      totalNetCost,
    });
  }, [
    activeTargets,
    buyerToNetRate,
    catalogMap,
    rowResolution,
    selectedTarget,
    targetPriceOverrides,
    totalNetCost,
  ]);

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
    targetRarity,
    setTargetRarity,
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
