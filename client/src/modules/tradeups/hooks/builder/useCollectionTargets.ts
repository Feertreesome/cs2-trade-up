import React from "react";
import {
  fetchCollectionTargets,
  type CollectionTargetsResponse,
  type TargetRarity,
} from "../../services/api";

export interface UseCollectionTargetsResult {
  response: CollectionTargetsResponse | null;
  targets: CollectionTargetsResponse["targets"];
  loading: boolean;
  error: string | null;
  reload: () => void;
  reset: () => void;
}

export function useCollectionTargets(
  collectionTag: string | null,
  rarity: TargetRarity,
): UseCollectionTargetsResult {
  const [response, setResponse] = React.useState<CollectionTargetsResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadToken, reload] = React.useReducer((token) => token + 1, 0);

  React.useEffect(() => {
    if (!collectionTag) {
      setResponse(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setResponse(null);

    (async () => {
      try {
        const result = await fetchCollectionTargets(collectionTag, rarity);
        if (cancelled) return;
        setResponse(result);
      } catch (error: any) {
        if (cancelled) return;
        setError(String(error?.message || error));
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [collectionTag, rarity, reloadToken]);

  const reset = React.useCallback(() => {
    setResponse(null);
    setError(null);
  }, []);

  return {
    response,
    targets: response?.targets ?? [],
    loading,
    error,
    reload,
    reset,
  };
}
