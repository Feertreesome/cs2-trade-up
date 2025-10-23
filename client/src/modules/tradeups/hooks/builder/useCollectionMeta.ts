import React from "react";
import { buildCollectionLookups, buildCollectionOptions } from "./collectionOptions";
import type {
  CollectionInputsResponse,
  CollectionTargetsResponse,
  SteamCollectionSummary,
} from "../../services/api";
import type { CollectionSelectOption, TradeupInputFormRow } from "../types";

/**
 * Формирует опции и словари коллекций на основе свежих API-ответов и текущего выбора пользователя.
 */

interface CollectionMetaParams {
  steamCollections: SteamCollectionSummary[];
  targetsResponse: CollectionTargetsResponse | null;
  inputsResponse: CollectionInputsResponse | null;
  rows: TradeupInputFormRow[];
  selectedCollectionId: string | null;
  activeCollectionTag: string | null;
}

export const useCollectionMeta = ({
  steamCollections,
  targetsResponse,
  inputsResponse,
  rows,
  selectedCollectionId,
  activeCollectionTag,
}: CollectionMetaParams) => {
  const collectionOptions = React.useMemo<CollectionSelectOption[]>(
    () =>
      buildCollectionOptions({
        steamCollections,
        targetsResponse,
        inputsResponse,
        rows,
        selectedCollectionId,
        activeCollectionTag,
      }),
    [
      activeCollectionTag,
      inputsResponse,
      rows,
      selectedCollectionId,
      steamCollections,
      targetsResponse,
    ],
  );

  const lookups = React.useMemo(
    () =>
      buildCollectionLookups({
        steamCollections,
        targetsResponse,
        inputsResponse,
        selectedCollectionId,
        activeCollectionTag,
      }),
    [
      activeCollectionTag,
      inputsResponse,
      selectedCollectionId,
      steamCollections,
      targetsResponse,
    ],
  );

  return { collectionOptions, collectionIdByTag: lookups.idByTag, collectionTagById: lookups.tagById };
};
