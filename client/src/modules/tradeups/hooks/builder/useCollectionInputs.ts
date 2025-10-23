import React from "react";
import {
  fetchCollectionInputs,
  type CollectionInputsResponse,
  type TargetRarity,
} from "../../services/api";

export interface UseCollectionInputsResult {
  response: CollectionInputsResponse | null;
  loading: boolean;
  error: string | null;
  load: (collectionTag: string, rarity: TargetRarity) => Promise<CollectionInputsResponse>;
  reset: () => void;
}

export function useCollectionInputs(): UseCollectionInputsResult {
  const [response, setResponse] = React.useState<CollectionInputsResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (collectionTag: string, rarity: TargetRarity) => {
      try {
        setLoading(true);
        setError(null);
        const result = await fetchCollectionInputs(collectionTag, rarity);
        setResponse(result);
        return result;
      } catch (error: any) {
        setResponse(null);
        setError(String(error?.message || error));
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const reset = React.useCallback(() => {
    setResponse(null);
    setError(null);
  }, []);

  return {
    response,
    loading,
    error,
    load,
    reset,
  };
}
