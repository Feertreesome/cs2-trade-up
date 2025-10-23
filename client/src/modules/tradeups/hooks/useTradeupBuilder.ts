import React from "react";
import {
  batchPriceOverview,
  fetchCollectionInputs,
  fetchCollectionTargets,
  fetchSteamCollections,
  requestTradeupCalculation,
  requestTradeupAvailability,
  type CollectionInputSummary,
  type CollectionInputsResponse,
  type CollectionTargetExterior,
  type CollectionTargetsResponse,
  type SteamCollectionSummary,
  type TargetRarity,
  type TradeupCalculationResponse,
} from "../services/api";
import {
  buildCollectionSelectValue,
  createInitialRows,
  readTagFromCollectionValue,
} from "./helpers";
import { planRowsForCollection } from "./rowPlanning";
import { resolveTradeupRows } from "./rowResolution";
import type {
  CollectionSelectOption,
  ParsedTradeupRow,
  RowResolution,
  SelectedTarget,
  TradeupInputFormRow,
  TradeupAvailabilityState,
} from "./types";

export type {
  TradeupInputFormRow,
  CollectionSelectOption,
  SelectedTarget,
} from "./types";

/**
 * Хук инкапсулирует весь state и бизнес-логику для TradeupBuilder:
 * загрузку справочников, выбор целей, управление входами и отправку расчёта на сервер.
 */

export default function useTradeupBuilder() {
  const [steamCollections, setSteamCollections] = React.useState<SteamCollectionSummary[]>([]);
  const [loadingSteamCollections, setLoadingSteamCollections] = React.useState(false);
  const [steamCollectionError, setSteamCollectionError] = React.useState<string | null>(null);

  const [activeCollectionTag, setActiveCollectionTag] = React.useState<string | null>(null);
  const [targetsReloadToken, setTargetsReloadToken] = React.useState(0);
  const [targetRarity, setTargetRarityState] = React.useState<TargetRarity>("Covert");
  const [activeTargetsResponse, setActiveTargetsResponse] =
    React.useState<CollectionTargetsResponse | null>(null);
  const [loadingTargets, setLoadingTargets] = React.useState(false);
  const [targetsError, setTargetsError] = React.useState<string | null>(null);

  const [activeInputsResponse, setActiveInputsResponse] =
    React.useState<CollectionInputsResponse | null>(null);
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
  const [availabilityState, setAvailabilityState] = React.useState<TradeupAvailabilityState>({
    activeOutcomeKey: null,
    loading: false,
    error: null,
    result: null,
    outcomeLabel: null,
    outcomeMarketHashName: null,
  });

  const buyerToNetRate = 1 + Math.max(0, buyerFeePercent) / 100;

  /** Отдельная карта steam-tag → информация о коллекции для быстрых lookup'ов. */
  const steamCollectionsByTag = React.useMemo(
    () => new Map(steamCollections.map((entry) => [entry.tag, entry] as const)),
    [steamCollections],
  );
  const steamCollectionsById = React.useMemo(() => {
    const map = new Map<string, SteamCollectionSummary>();
    for (const entry of steamCollections) {
      if (entry.collectionId) {
        map.set(entry.collectionId, entry);
      }
    }
    return map;
  }, [steamCollections]);

  /** Опции для выпадающего списка выбора коллекций в таблице входов. */
  const collectionOptions: CollectionSelectOption[] = React.useMemo(() => {
    const map = new Map<string, CollectionSelectOption>();
    const isFallbackLabel = (value: string, label: string) => !label || label === value;
    const resolveLabel = (
      value: string,
      details: { collectionId: string | null; tag: string | null; name?: string | null },
    ) => {
      return (
        details.name ??
        (details.collectionId ? steamCollectionsById.get(details.collectionId)?.name : undefined) ??
        (details.tag ? steamCollectionsByTag.get(details.tag)?.name : undefined) ??
        value
      );
    };
    const addOption = (
      value: string,
      details: { collectionId: string | null; tag: string | null; name?: string | null },
    ) => {
      if (!value) return;
      const label = resolveLabel(value, details);
      const supported = Boolean(details.collectionId);
      const existing = map.get(value);
      if (existing) {
        const shouldUpgradeLabel =
          !isFallbackLabel(value, label) &&
          (isFallbackLabel(existing.value, existing.label) || existing.label !== label);
        const shouldUpgradeSupport = !existing.supported && supported;
        if (shouldUpgradeLabel || shouldUpgradeSupport) {
          map.set(value, {
            value,
            label: shouldUpgradeLabel ? label : existing.label,
            supported: shouldUpgradeSupport ? supported : existing.supported,
          });
        }
        return;
      }
      map.set(value, { value, label, supported });
    };

    for (const entry of steamCollections) {
      const value = buildCollectionSelectValue(entry.collectionId, entry.tag);
      addOption(value, {
        collectionId: entry.collectionId ?? null,
        tag: entry.tag,
        name: entry.name,
      });
    }

    if (activeTargetsResponse) {
      const value = buildCollectionSelectValue(
        activeTargetsResponse.collectionId,
        activeTargetsResponse.collectionTag,
      );
      addOption(value, {
        collectionId: activeTargetsResponse.collectionId ?? null,
        tag: activeTargetsResponse.collectionTag,
      });
    }

    if (activeInputsResponse) {
      const value = buildCollectionSelectValue(
        activeInputsResponse.collectionId,
        activeInputsResponse.collectionTag,
      );
      addOption(value, {
        collectionId: activeInputsResponse.collectionId ?? null,
        tag: activeInputsResponse.collectionTag,
      });
    }

    for (const row of rows) {
      if (!row.collectionId) continue;
      const tag = readTagFromCollectionValue(row.collectionId);
      const value = tag
        ? buildCollectionSelectValue(null, tag)
        : buildCollectionSelectValue(row.collectionId, null);
      addOption(value, {
        collectionId: tag ? null : row.collectionId,
        tag,
      });
    }

    if (selectedCollectionId || activeCollectionTag) {
      const value = buildCollectionSelectValue(selectedCollectionId, activeCollectionTag);
      addOption(value, {
        collectionId: selectedCollectionId ?? null,
        tag: activeCollectionTag,
      });
    }

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [
    activeCollectionTag,
    activeInputsResponse,
    activeTargetsResponse,
    rows,
    selectedCollectionId,
    steamCollections,
    steamCollectionsById,
    steamCollectionsByTag,
  ]);

  /** Быстрая таблица соответствий steam-tag → collectionId. */
  const collectionIdByTag = React.useMemo(() => {
    const map = new Map<string, string>();

    for (const entry of steamCollections) {
      if (entry.collectionId) {
        map.set(entry.tag, entry.collectionId);
      }
    }

    if (activeTargetsResponse?.collectionId && activeTargetsResponse.collectionTag) {
      map.set(activeTargetsResponse.collectionTag, activeTargetsResponse.collectionId);
    }

    if (activeInputsResponse?.collectionId && activeInputsResponse.collectionTag) {
      map.set(activeInputsResponse.collectionTag, activeInputsResponse.collectionId);
    }

    if (selectedCollectionId && activeCollectionTag) {
      map.set(activeCollectionTag, selectedCollectionId);
    }

    return map;
  }, [
    activeCollectionTag,
    activeInputsResponse,
    activeTargetsResponse,
    steamCollections,
    selectedCollectionId,
  ]);

  /** Быстрая таблица соответствий collectionId → steam-tag. */
  const collectionTagById = React.useMemo(() => {
    const map = new Map<string, string>();

    const register = (collectionId?: string | null, tag?: string | null) => {
      if (!collectionId || !tag) return;
      if (map.has(collectionId)) return;
      map.set(collectionId, tag);
    };

    for (const entry of steamCollections) {
      register(entry.collectionId, entry.tag);
    }

    if (activeTargetsResponse) {
      register(activeTargetsResponse.collectionId, activeTargetsResponse.collectionTag);
    }

    if (activeInputsResponse) {
      register(activeInputsResponse.collectionId, activeInputsResponse.collectionTag);
    }

    if (selectedCollectionId && activeCollectionTag) {
      register(selectedCollectionId, activeCollectionTag);
    }

    return map;
  }, [
    activeCollectionTag,
    activeInputsResponse,
    activeTargetsResponse,
    selectedCollectionId,
    steamCollections,
  ]);

  /** Подтягивает живой список коллекций из Steam Community Market. */
  const loadSteamCollections = React.useCallback(async () => {
    try {
      setSteamCollectionError(null);
      setLoadingSteamCollections(true);
      const steamCollectionList = await fetchSteamCollections();
      setSteamCollections(steamCollectionList);
    } catch (error: any) {
      setSteamCollectionError(String(error?.message || error));
    } finally {
      setLoadingSteamCollections(false);
    }
  }, []);

  const activeTargets = React.useMemo(() => {
    return activeTargetsResponse?.targets ?? [];
  }, [activeTargetsResponse]);

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
      setInputsError(null);
      setSelectedTarget(null);
      setCalculation(null);
      setCalculationError(null);
      setActiveTargetsResponse(null);
      setActiveInputsResponse(null);
      setSelectedCollectionId(null);
    },
    [targetRarity],
  );

  /**
   * Выбор коллекции: сбрасывает форму, подгружает цели и при наличии — collectionId из справочника.
   */
  const selectCollection = React.useCallback((collectionTag: string) => {
    setActiveCollectionTag(collectionTag);
    setTargetsError(null);
    setInputsError(null);
    setSelectedTarget(null);
    setCalculation(null);
    setCalculationError(null);
    setRows(createInitialRows());
    setActiveTargetsResponse(null);
    setActiveInputsResponse(null);
    setSelectedCollectionId(null);
    setTargetsReloadToken((prev) => prev + 1);
  }, []);

  React.useEffect(() => {
    if (!activeCollectionTag) {
      setActiveTargetsResponse(null);
      setSelectedCollectionId(null);
      setLoadingTargets(false);
      return;
    }

    let cancelled = false;
    setLoadingTargets(true);
    setTargetsError(null);
    setActiveTargetsResponse(null);
    setSelectedCollectionId(null);

    (async () => {
      try {
        const result = await fetchCollectionTargets(activeCollectionTag, targetRarity);
        if (cancelled) return;
        setActiveTargetsResponse(result);
        setSelectedCollectionId(result.collectionId ?? null);
      } catch (error: any) {
        if (cancelled) return;
        setTargetsError(String(error?.message || error));
      } finally {
        if (cancelled) return;
        setLoadingTargets(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeCollectionTag, targetRarity, targetsReloadToken]);

  /** Загружает список входов для указанной коллекции. */
  const loadInputsForCollection = React.useCallback(
    async (collectionTag: string, rarity: TargetRarity) => {
      try {
        setInputsLoading(true);
        setInputsError(null);
        const result = await fetchCollectionInputs(collectionTag, rarity);
        setActiveInputsResponse(result);
        return result;
      } catch (error: any) {
        setActiveInputsResponse(null);
        setInputsError(String(error?.message || error));
        throw error;
      } finally {
        setInputsLoading(false);
      }
    },
    [],
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
        const resolvedCollectionId =
          response.collectionId ??
          (activeTargetsResponse?.collectionTag === collectionTag
            ? activeTargetsResponse.collectionId ?? null
            : null) ??
          steamCollections.find((entry) => entry.tag === collectionTag)?.collectionId ??
          selectedCollectionId ??
          null;

        if (resolvedCollectionId) {
          setSelectedCollectionId(resolvedCollectionId);
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
      activeTargetsResponse,
      loadInputsForCollection,
      selectedCollectionId,
      steamCollections,
      targetRarity,
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
      steamCollectionsByTag,
      collectionIdByTag,
      collectionTagById,
      steamCollectionsById,
    });
  }, [
    parsedRows,
    collectionIdByTag,
    collectionTagById,
    selectedCollectionId,
    steamCollectionsById,
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
        targetRarity,
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
    buyerToNetRate,
    rowResolution,
    selectedTarget,
    targetRarity,
  ]);

  const checkAvailability = React.useCallback(
    async (outcome: TradeupCalculationResponse["outcomes"][number]) => {
      if (!calculation) {
        setAvailabilityState({
          activeOutcomeKey: null,
          loading: false,
          error: "Сначала рассчитайте trade-up",
          result: null,
          outcomeLabel: null,
          outcomeMarketHashName: null,
        });
        return;
      }

      const slots = calculation.inputs.map((input, index) => ({
        index,
        marketHashName: input.marketHashName,
      }));

      const outcomeKey = `${outcome.collectionId}:${outcome.marketHashName}`;
      const outcomeLabel = `${outcome.baseName} (${outcome.exterior})`;

      setAvailabilityState((prev) => ({
        ...prev,
        activeOutcomeKey: outcomeKey,
        loading: true,
        error: null,
        outcomeLabel,
        outcomeMarketHashName: outcome.marketHashName,
      }));

      try {
        const payload = {
          outcome: {
            marketHashName: outcome.marketHashName,
            minFloat: outcome.minFloat,
            maxFloat: outcome.maxFloat,
            rollFloat: outcome.rollFloat,
          },
          slots,
          limit: 50,
          targetAverageFloat: calculation.averageFloat,
        } satisfies Parameters<typeof requestTradeupAvailability>[0];
        const result = await requestTradeupAvailability(payload);
        setAvailabilityState((prev) => ({
          ...prev,
          loading: false,
          result,
          error: null,
        }));
      } catch (error: any) {
        setAvailabilityState((prev) => ({
          ...prev,
          loading: false,
          result: null,
          error: String(error?.message || error),
        }));
      }
    },
    [calculation],
  );

  return {
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
    autofillPrices,
    priceLoading,
    calculate,
    calculation,
    calculating,
    calculationError,
    availabilityState,
    checkAvailability,
  };
}
