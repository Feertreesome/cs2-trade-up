import React from "react";
import { type TargetRarity } from "../services/api";
import { useAggregateCosts } from "./builder/useAggregateCosts";
import { useAvailabilityChecker } from "./builder/useAvailabilityChecker";
import { useCollectionInputs } from "./builder/useCollectionInputs";
import { useCollectionTargets } from "./builder/useCollectionTargets";
import { useCollectionMeta } from "./builder/useCollectionMeta";
import { useCollectionSelector } from "./builder/useCollectionSelector";
import { useParsedRows } from "./builder/useParsedRows";
import { usePriceAutofill } from "./builder/usePriceAutofill";
import { useRowPlanner } from "./builder/useRowPlanner";
import { useRowResolution } from "./builder/useRowResolution";
import { useSteamCollections } from "./builder/useSteamCollections";
import { useTradeupCalculation } from "./builder/useTradeupCalculation";
import { useTradeupRowsState } from "./builder/useTradeupRowsState";
import { useTargetSelectionHandler } from "./builder/useTargetSelectionHandler";
import type {
  CollectionSelectOption,
  SelectedTarget,
  TradeupAvailabilityState,
} from "./types";

export type { TradeupInputFormRow, CollectionSelectOption, SelectedTarget } from "./types";

/**
 * Главный оркестратор конструктора trade-up. Собирает специализированные хуки
 * загрузки данных, выбора коллекций, планирования строк и расчёта EV в единое состояние.
 */
export default function useTradeupBuilder() {
  const {
    collections: steamCollections,
    loading: loadingSteamCollections,
    error: steamCollectionError,
    load: loadSteamCollections,
    byTag: steamCollectionsByTag,
    byId: steamCollectionsById,
  } = useSteamCollections();
  const [activeCollectionTag, setActiveCollectionTag] = React.useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = React.useState<string | null>(null);
  const [targetRarity, setTargetRarityState] = React.useState<TargetRarity>("Covert");
  const targetsState = useCollectionTargets(activeCollectionTag, targetRarity);
  const inputsState = useCollectionInputs();
  const { rows, setRows, resetRows, updateRow } = useTradeupRowsState();
  const [selectedTarget, setSelectedTarget] = React.useState<SelectedTarget | null>(null);
  React.useEffect(() => {
    if (!targetsState.response) return;
    setSelectedCollectionId(targetsState.response.collectionId ?? null);
  }, [targetsState.response]);

  const { collectionOptions, collectionIdByTag, collectionTagById } = useCollectionMeta({
    steamCollections,
    targetsResponse: targetsState.response,
    inputsResponse: inputsState.response,
    rows,
    selectedCollectionId,
    activeCollectionTag,
  });

  const parsedRows = useParsedRows(rows);

  const rowResolution = useRowResolution({
    parsedRows,
    selectedCollectionId,
    steamCollectionsByTag,
    collectionIdByTag,
    collectionTagById,
    steamCollectionsById,
  });

  const {
    calculation,
    calculating,
    calculationError,
    setCalculationError,
    resetCalculation,
    calculate,
  } = useTradeupCalculation({
    parsedRows,
    rowResolution,
    selectedTarget,
    targetRarity,
    setSelectedCollectionId,
  });

  const { availabilityState, checkAvailability, resetAvailability } = useAvailabilityChecker({
    calculation,
  });

  const { priceLoading, autofillPrices } = usePriceAutofill({
    rows,
    setRows,
    reportError: setCalculationError,
  });

  const applyInputsToRows = useRowPlanner({
    selectedCollectionId,
    setRows,
    autofillPrices,
  });

  const clearTransientState = React.useCallback(() => {
    setSelectedTarget(null);
    resetCalculation();
    resetAvailability();
  }, [resetAvailability, resetCalculation]);

  const setTargetRarity = React.useCallback(
    (rarity: TargetRarity) => {
      if (rarity === targetRarity) return;
      setTargetRarityState(rarity);
      setSelectedCollectionId(null);
      targetsState.reset();
      inputsState.reset();
      resetRows();
      clearTransientState();
    },
    [
      clearTransientState,
      inputsState,
      resetRows,
      targetRarity,
      targetsState,
    ],
  );

  const selectCollection = useCollectionSelector({
    setActiveCollectionTag,
    setSelectedCollectionId,
    targetsState,
    inputsState,
    resetRows,
    onReset: clearTransientState,
  });

  const selectTarget = useTargetSelectionHandler({
    inputsState,
    targetsState,
    targetRarity,
    selectedCollectionId,
    setSelectedCollectionId,
    steamCollectionsByTag,
    collectionIdByTag,
    applyInputsToRows,
    resetCalculation,
    setSelectedTarget,
  });

  const { averageFloat, totalInputCost } = useAggregateCosts(parsedRows);

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
    collectionTargets: targetsState.targets,
    loadingTargets: targetsState.loading,
    targetsError: targetsState.error,
    selectedTarget,
    selectTarget,
    inputsLoading: inputsState.loading,
    inputsError: inputsState.error,
    rows,
    updateRow,
    averageFloat,
    totalInputCost,
    autofillPrices,
    priceLoading,
    calculate,
    calculation,
    calculating,
    calculationError,
    availabilityState,
    checkAvailability,
  } satisfies {
    availabilityState: TradeupAvailabilityState;
    checkAvailability: ReturnType<typeof useAvailabilityChecker>["checkAvailability"];
  };
}
