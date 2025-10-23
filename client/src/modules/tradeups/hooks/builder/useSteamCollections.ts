import React from "react";
import {
  fetchSteamCollections,
  type SteamCollectionSummary,
} from "../../services/api";

/**
 * Отвечает за загрузку списка коллекций из Steam и предоставляет быстрые словари по тегу/ID.
 */

interface SteamCollectionsState {
  collections: SteamCollectionSummary[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  byTag: Map<string, SteamCollectionSummary>;
  byId: Map<string, SteamCollectionSummary>;
}

const buildCollectionMap = <Key extends "tag" | "collectionId">(
  collections: SteamCollectionSummary[],
  key: Key,
) => {
  const map = new Map<string, SteamCollectionSummary>();
  for (const entry of collections) {
    const value = entry[key];
    if (value) {
      map.set(value, entry);
    }
  }
  return map;
};

export function useSteamCollections(): SteamCollectionsState {
  const [collections, setCollections] = React.useState<SteamCollectionSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const response = await fetchSteamCollections();
      setCollections(response);
    } catch (error: any) {
      setError(String(error?.message || error));
    } finally {
      setLoading(false);
    }
  }, []);

  const byTag = React.useMemo(() => buildCollectionMap(collections, "tag"), [collections]);
  const byId = React.useMemo(
    () => buildCollectionMap(collections, "collectionId"),
    [collections],
  );

  return { collections, loading, error, load, byTag, byId };
}
