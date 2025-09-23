import { EXTERIORS, type Exterior, type Rarity } from "./types";

type CaseBuckets = Record<string, string[]>;

export type SchemaOutput = {
  name: string;
  minFloat: number;
  maxFloat: number;
};

export type SkinsSchema = {
  itemToCase?: Record<string, string>;
  caseOutputs?: Record<string, SchemaOutput[]>;
  caseCovert?: CaseBuckets;
  caseClassified?: CaseBuckets;
  caseRestricted?: CaseBuckets;
  caseMilSpec?: CaseBuckets;
};

type CaseKey = "caseCovert" | "caseClassified" | "caseRestricted" | "caseMilSpec";

const CASE_KEY_BY_RARITY: Record<Rarity, CaseKey | null> = {
  Covert: "caseCovert",
  Classified: "caseClassified",
  Restricted: "caseRestricted",
  "Mil-Spec": "caseMilSpec",
};

export const LOWER_RARITY_MAP: Record<Rarity, Rarity | null> = {
  Covert: "Classified",
  Classified: "Restricted",
  Restricted: "Mil-Spec",
  "Mil-Spec": null,
};

let schemaPromise: Promise<SkinsSchema> | null = null;

export const fetchSkinsSchema = async (): Promise<SkinsSchema> => {
  if (!schemaPromise) {
    schemaPromise = fetch("/api/skins/schema")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<SkinsSchema>;
      })
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
};

export const getCollectionForSkin = (
  schema: SkinsSchema | null,
  baseName: string,
): string | null => schema?.itemToCase?.[baseName] ?? null;

export const getCaseSkinsByRarity = (
  schema: SkinsSchema | null,
  collection: string,
  rarity: Rarity,
): string[] => {
  const key = CASE_KEY_BY_RARITY[rarity];
  if (!key) return [];
  const bucket = schema?.[key] as CaseBuckets | undefined;
  return bucket?.[collection] ?? [];
};

const EXTERIOR_FLOAT_RANGES: Record<Exterior, { min: number; max: number }> = {
  "Factory New": { min: 0.0, max: 0.07 },
  "Minimal Wear": { min: 0.07, max: 0.15 },
  "Field-Tested": { min: 0.15, max: 0.38 },
  "Well-Worn": { min: 0.38, max: 0.45 },
  "Battle-Scarred": { min: 0.45, max: 1.0 },
};

const overlaps = (aMin: number, aMax: number, bMin: number, bMax: number) =>
  aMax >= bMin && bMax >= aMin;

export const getAvailableExteriors = (
  schema: SkinsSchema | null,
  collection: string,
  baseName: string,
): Exterior[] => {
  const outputs = schema?.caseOutputs?.[collection];
  const entry = outputs?.find((item) => item.name === baseName);
  if (!entry) return EXTERIORS.slice();
  const { minFloat, maxFloat } = entry;
  return EXTERIORS.filter((exterior) => {
    const range = EXTERIOR_FLOAT_RANGES[exterior];
    return overlaps(minFloat, maxFloat, range.min, range.max);
  });
};
