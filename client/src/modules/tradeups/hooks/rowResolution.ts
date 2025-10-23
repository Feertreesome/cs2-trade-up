import type { SteamCollectionSummary } from "../services/api";
import { readTagFromCollectionValue } from "./helpers";
import type { ParsedTradeupRow, ResolvedTradeupRow, RowResolution } from "./types";

interface ResolveRowsParams {
  parsedRows: ParsedTradeupRow[];
  selectedCollectionId: string | null;
  steamCollectionsByTag: Map<string, SteamCollectionSummary>;
  collectionIdByTag: Map<string, string>;
  collectionTagById: Map<string, string>;
  steamCollectionsById: Map<string, SteamCollectionSummary>;
}

export const resolveTradeupRows = ({
  parsedRows,
  selectedCollectionId,
  steamCollectionsByTag,
  collectionIdByTag,
  collectionTagById,
  steamCollectionsById,
}: ResolveRowsParams): RowResolution => {
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
    const tagFromValue = readTagFromCollectionValue(row.collectionId);
    const fallbackTag =
      tagFromValue ?? (row.collectionId ? collectionTagById.get(row.collectionId) ?? null : null);
    const steamEntry = fallbackTag ? steamCollectionsByTag.get(fallbackTag) : undefined;

    let resolvedId: string | null = null;

    if (row.collectionId && !tagFromValue) {
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

    let resolvedName: string | null = steamEntry?.name ?? null;

    if (!resolvedName && resolvedId) {
      resolvedName = steamCollectionsById.get(resolvedId)?.name ?? null;
      if (!resolvedName) {
        const tag = collectionTagById.get(resolvedId);
        resolvedName = tag ? steamCollectionsByTag.get(tag)?.name ?? null : null;
      }
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
    new Set(unresolvedRows.map((row) => row.resolvedCollectionName ?? row.collectionId ?? "неизвестно")),
  );

  const collectionCounts = new Map<string, number>();
  for (const row of rowsWithResolved) {
    if (!row.resolvedCollectionId) continue;
    collectionCounts.set(row.resolvedCollectionId, (collectionCounts.get(row.resolvedCollectionId) ?? 0) + 1);
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
};
