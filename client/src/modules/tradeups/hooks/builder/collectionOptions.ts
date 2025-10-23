import {
  buildCollectionSelectValue,
  readTagFromCollectionValue,
} from "../helpers";
import type {
  CollectionSelectOption,
  TradeupInputFormRow,
} from "../types";
import type {
  CollectionInputsResponse,
  CollectionTargetsResponse,
  SteamCollectionSummary,
} from "../../services/api";

/**
 * Строит список опций и вспомогательные отображения коллекций для выпадающего списка выбора.
 * Смешивает данные из Steam, свежих ответов API и текущих строк ввода.
 */
interface CollectionOptionParams {
  steamCollections: SteamCollectionSummary[];
  targetsResponse: CollectionTargetsResponse | null;
  inputsResponse: CollectionInputsResponse | null;
  rows: TradeupInputFormRow[];
  selectedCollectionId: string | null;
  activeCollectionTag: string | null;
}

interface CollectionLookupParams {
  steamCollections: SteamCollectionSummary[];
  targetsResponse: CollectionTargetsResponse | null;
  inputsResponse: CollectionInputsResponse | null;
  selectedCollectionId: string | null;
  activeCollectionTag: string | null;
}

const resolveOptionLabel = (
  value: string,
  details: {
    collectionId: string | null;
    tag: string | null;
    name?: string | null;
  },
  collectionsById: Map<string, SteamCollectionSummary>,
  collectionsByTag: Map<string, SteamCollectionSummary>,
) => {
  return (
    details.name ??
    (details.collectionId ? collectionsById.get(details.collectionId)?.name : undefined) ??
    (details.tag ? collectionsByTag.get(details.tag)?.name : undefined) ??
    value
  );
};

const appendOption = (
  map: Map<string, CollectionSelectOption>,
  value: string,
  details: {
    collectionId: string | null;
    tag: string | null;
    name?: string | null;
  },
  collectionsById: Map<string, SteamCollectionSummary>,
  collectionsByTag: Map<string, SteamCollectionSummary>,
) => {
  if (!value) return;
  const label = resolveOptionLabel(value, details, collectionsById, collectionsByTag);
  const supported = Boolean(details.collectionId);
  const existing = map.get(value);

  if (existing) {
    const existingIsFallback = !existing.label || existing.label === existing.value;
    const nextIsFallback = !label || label === value;
    const shouldUpgradeLabel = !nextIsFallback && (existingIsFallback || existing.label !== label);
    const shouldUpgradeSupport = !existing.supported && supported;

    if (shouldUpgradeLabel || shouldUpgradeSupport) {
      map.set(value, {
        value,
        label: shouldUpgradeLabel ? label : existing.label,
        supported: shouldUpgradeSupport ? supported : existing.supported,
      });
    }
    return;
  }

  map.set(value, { value, label, supported });
};

export const buildCollectionOptions = ({
  steamCollections,
  targetsResponse,
  inputsResponse,
  rows,
  selectedCollectionId,
  activeCollectionTag,
}: CollectionOptionParams): CollectionSelectOption[] => {
  const map = new Map<string, CollectionSelectOption>();
  const collectionsById = new Map(steamCollections.map((entry) => [entry.collectionId, entry]));
  const collectionsByTag = new Map(steamCollections.map((entry) => [entry.tag, entry]));

  for (const entry of steamCollections) {
    const value = buildCollectionSelectValue(entry.collectionId, entry.tag);
    appendOption(
      map,
      value,
      { collectionId: entry.collectionId ?? null, tag: entry.tag, name: entry.name },
      collectionsById,
      collectionsByTag,
    );
  }

  if (targetsResponse) {
    appendOption(
      map,
      buildCollectionSelectValue(targetsResponse.collectionId, targetsResponse.collectionTag),
      {
        collectionId: targetsResponse.collectionId ?? null,
        tag: targetsResponse.collectionTag,
      },
      collectionsById,
      collectionsByTag,
    );
  }

  if (inputsResponse) {
    appendOption(
      map,
      buildCollectionSelectValue(inputsResponse.collectionId, inputsResponse.collectionTag),
      {
        collectionId: inputsResponse.collectionId ?? null,
        tag: inputsResponse.collectionTag,
      },
      collectionsById,
      collectionsByTag,
    );
  }

  for (const row of rows) {
    if (!row.collectionId) continue;
    const tag = readTagFromCollectionValue(row.collectionId);
    const value = tag
      ? buildCollectionSelectValue(null, tag)
      : buildCollectionSelectValue(row.collectionId, null);
    appendOption(
      map,
      value,
      { collectionId: tag ? null : row.collectionId, tag },
      collectionsById,
      collectionsByTag,
    );
  }

  if (selectedCollectionId || activeCollectionTag) {
    appendOption(
      map,
      buildCollectionSelectValue(selectedCollectionId, activeCollectionTag),
      { collectionId: selectedCollectionId ?? null, tag: activeCollectionTag },
      collectionsById,
      collectionsByTag,
    );
  }

  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "ru"));
};

export const buildCollectionLookups = ({
  steamCollections,
  targetsResponse,
  inputsResponse,
  selectedCollectionId,
  activeCollectionTag,
}: CollectionLookupParams) => {
  const idByTag = new Map<string, string>();
  const tagById = new Map<string, string>();

  const register = (collectionId?: string | null, tag?: string | null) => {
    if (!collectionId || !tag) return;
    if (!tagById.has(collectionId)) {
      tagById.set(collectionId, tag);
    }
    if (!idByTag.has(tag)) {
      idByTag.set(tag, collectionId);
    }
  };

  for (const entry of steamCollections) {
    register(entry.collectionId, entry.tag);
  }

  if (targetsResponse) {
    register(targetsResponse.collectionId, targetsResponse.collectionTag);
  }

  if (inputsResponse) {
    register(inputsResponse.collectionId, inputsResponse.collectionTag);
  }

  register(selectedCollectionId, activeCollectionTag);

  return { idByTag, tagById };
};
