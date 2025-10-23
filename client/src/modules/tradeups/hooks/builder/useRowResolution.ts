import React from "react";
import { resolveTradeupRows } from "../rowResolution";
import type { ParsedTradeupRow, RowResolution } from "../types";
import type { SteamCollectionSummary } from "../../services/api";

/**
 * Резолвит введённые строки в коллекции, используя кэшированные словари и свежие данные из API.
 */

interface RowResolutionOptions {
  parsedRows: ParsedTradeupRow[];
  selectedCollectionId: string | null;
  steamCollectionsByTag: Map<string, SteamCollectionSummary>;
  collectionIdByTag: Map<string, string>;
  collectionTagById: Map<string, string>;
  steamCollectionsById: Map<string, SteamCollectionSummary>;
}

export const useRowResolution = ({
  parsedRows,
  selectedCollectionId,
  steamCollectionsByTag,
  collectionIdByTag,
  collectionTagById,
  steamCollectionsById,
}: RowResolutionOptions): RowResolution => {
  return React.useMemo(() => {
    return resolveTradeupRows({
      parsedRows,
      selectedCollectionId,
      steamCollectionsByTag,
      collectionIdByTag,
      collectionTagById,
      steamCollectionsById,
    });
  }, [
    collectionIdByTag,
    collectionTagById,
    parsedRows,
    selectedCollectionId,
    steamCollectionsById,
    steamCollectionsByTag,
  ]);
};
