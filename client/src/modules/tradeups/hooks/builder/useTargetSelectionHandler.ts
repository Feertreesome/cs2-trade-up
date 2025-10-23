import React from "react";
import type {
  CollectionInputsResponse,
  CollectionTargetsResponse,
  CollectionTargetExterior,
  SteamCollectionSummary,
  TargetRarity,
} from "../../services/api";
import type { UseCollectionInputsResult } from "./useCollectionInputs";
import type { UseCollectionTargetsResult } from "./useCollectionTargets";
import type { SelectedTarget } from "../types";

/**
 * Возвращает обработчик выбора целевого скина: обновляет выделение коллекции
 * и применяет подходящие входы к таблице.
 */

interface TargetSelectionHandlerOptions {
  inputsState: UseCollectionInputsResult;
  targetsState: UseCollectionTargetsResult;
  targetRarity: TargetRarity;
  selectedCollectionId: string | null;
  setSelectedCollectionId: (collectionId: string | null) => void;
  steamCollectionsByTag: Map<string, SteamCollectionSummary>;
  collectionIdByTag: Map<string, string>;
  applyInputsToRows: (args: {
    collectionTag: string;
    collectionId: string | null;
    inputs: CollectionInputsResponse["inputs"];
    targetOptions: {
      exterior: CollectionTargetExterior["exterior"];
      minFloat?: number | null;
      maxFloat?: number | null;
    };
  }) => Promise<void>;
  resetCalculation: () => void;
  setSelectedTarget: (target: SelectedTarget) => void;
}

const resolveCollectionId = (
  response: CollectionInputsResponse | CollectionTargetsResponse | null,
  collectionTag: string,
  targetsState: UseCollectionTargetsResult,
  steamCollectionsByTag: Map<string, SteamCollectionSummary>,
  collectionIdByTag: Map<string, string>,
  fallbackCollectionId: string | null,
) => {
  return (
    response?.collectionId ??
    (targetsState.response?.collectionTag === collectionTag
      ? targetsState.response.collectionId ?? null
      : null) ??
    steamCollectionsByTag.get(collectionTag)?.collectionId ??
    collectionIdByTag.get(collectionTag) ??
    fallbackCollectionId ??
    null
  );
};

export const useTargetSelectionHandler = ({
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
}: TargetSelectionHandlerOptions) => {
  return React.useCallback(
    async (collectionTag: string, baseName: string, exterior: CollectionTargetExterior) => {
      setSelectedTarget({
        collectionTag,
        baseName,
        exterior: exterior.exterior,
        marketHashName: exterior.marketHashName,
        minFloat: exterior.minFloat,
        maxFloat: exterior.maxFloat,
        price: exterior.price ?? null,
      });
      resetCalculation();
      try {
        const response = await inputsState.load(collectionTag, targetRarity);
        const resolvedCollectionId = resolveCollectionId(
          response,
          collectionTag,
          targetsState,
          steamCollectionsByTag,
          collectionIdByTag,
          selectedCollectionId,
        );
        if (resolvedCollectionId) {
          setSelectedCollectionId(resolvedCollectionId);
        }
        await applyInputsToRows({
          collectionTag,
          collectionId: resolvedCollectionId,
          inputs: response.inputs,
          targetOptions: {
            exterior: exterior.exterior,
            minFloat: exterior.minFloat ?? null,
            maxFloat: exterior.maxFloat ?? null,
          },
        });
      } catch (error) {
        // handled inside useCollectionInputs
      }
    },
    [
      applyInputsToRows,
      collectionIdByTag,
      inputsState,
      resetCalculation,
      selectedCollectionId,
      setSelectedCollectionId,
      setSelectedTarget,
      steamCollectionsByTag,
      targetRarity,
      targetsState,
    ],
  );
};
