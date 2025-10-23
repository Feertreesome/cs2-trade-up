import type { SteamCollectionSummary } from "../services/api";
import { readTagFromCollectionValue } from "./helpers";
import type {
  CollectionValueMeta,
  ParsedTradeupRow,
  ResolvedTradeupRow,
  RowResolution,
} from "./types";

interface ResolveRowsParams {
  parsedRows: ParsedTradeupRow[];
  selectedCollectionId: string | null;
  collectionValueMeta: Map<string, CollectionValueMeta>;
  steamCollectionsByTag: Map<string, SteamCollectionSummary>;
  collectionIdByTag: Map<string, string>;
}

export const resolveTradeupRows = ({
  parsedRows,
  selectedCollectionId,
  collectionValueMeta,
  steamCollectionsByTag,
  collectionIdByTag,
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
    const meta = collectionValueMeta.get(row.collectionId);
    const fallbackTag = meta?.tag ?? readTagFromCollectionValue(row.collectionId);
    const steamEntry = fallbackTag ? steamCollectionsByTag.get(fallbackTag) : undefined;

    let resolvedId = meta?.collectionId ?? null;
    let resolvedName = meta?.name ?? steamEntry?.name ?? null;

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

    if (!resolvedName && steamEntry?.name) {
      resolvedName = steamEntry.name;
    }

    if (!resolvedName && resolvedId && meta?.name) {
      resolvedName = meta.name;
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
