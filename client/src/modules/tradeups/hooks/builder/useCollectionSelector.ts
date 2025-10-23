import React from "react";
import type { UseCollectionInputsResult } from "./useCollectionInputs";
import type { UseCollectionTargetsResult } from "./useCollectionTargets";

interface CollectionSelectorOptions {
  setActiveCollectionTag: (tag: string) => void;
  setSelectedCollectionId: (collectionId: string | null) => void;
  targetsState: UseCollectionTargetsResult;
  inputsState: UseCollectionInputsResult;
  resetRows: () => void;
  onReset: () => void;
}

export const useCollectionSelector = ({
  setActiveCollectionTag,
  setSelectedCollectionId,
  targetsState,
  inputsState,
  resetRows,
  onReset,
}: CollectionSelectorOptions) => {
  return React.useCallback(
    (collectionTag: string) => {
      setActiveCollectionTag(collectionTag);
      setSelectedCollectionId(null);
      targetsState.reset();
      inputsState.reset();
      resetRows();
      onReset();
      targetsState.reload();
    },
    [inputsState, onReset, resetRows, setActiveCollectionTag, setSelectedCollectionId, targetsState],
  );
};
