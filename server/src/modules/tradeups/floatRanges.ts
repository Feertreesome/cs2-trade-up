import { baseFromMarketHash } from "../skins/service";

interface RemoteSkin {
  name?: string | null;
  min_float?: number | null;
  max_float?: number | null;
}

export interface SkinFloatRange {
  minFloat: number;
  maxFloat: number;
}

const SOURCE_URL =
  process.env.SKIN_FLOAT_SOURCE_URL ||
  "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json";

let skinFloatMap: Map<string, SkinFloatRange> | null = null;
let loadingPromise: Promise<Map<string, SkinFloatRange> | null> | null = null;
let loadFailed = false;

const parseFloatOr = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? (parsed as number) : fallback;
};

const buildFloatMap = (skins: RemoteSkin[]): Map<string, SkinFloatRange> => {
  const map = new Map<string, SkinFloatRange>();
  for (const skin of skins) {
    const baseName = skin?.name?.trim();
    if (!baseName) continue;

    const minFloat = parseFloatOr(skin?.min_float, 0);
    const maxFloat = parseFloatOr(skin?.max_float, 1);
    if (!Number.isFinite(minFloat) || !Number.isFinite(maxFloat)) continue;

    const current = map.get(baseName);
    if (!current) {
      map.set(baseName, { minFloat, maxFloat });
      continue;
    }

    current.minFloat = Math.min(current.minFloat, minFloat);
    current.maxFloat = Math.max(current.maxFloat, maxFloat);
  }
  return map;
};

const ensureFloatMap = async (): Promise<Map<string, SkinFloatRange> | null> => {
  if (skinFloatMap) return skinFloatMap;
  if (loadFailed) return null;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const response = await fetch(SOURCE_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch skin floats: HTTP ${response.status}`);
      }
      const payload = (await response.json()) as RemoteSkin[];
      skinFloatMap = buildFloatMap(Array.isArray(payload) ? payload : []);
      return skinFloatMap;
    } catch (error) {
      console.warn(`[tradeups] Failed to load skin float catalog: ${String(error)}`);
      loadFailed = true;
      return null;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
};

export const getSkinFloatRange = async (
  marketHashName: string,
): Promise<SkinFloatRange | null> => {
  const baseName = baseFromMarketHash(marketHashName);
  const map = await ensureFloatMap();
  if (!map) return null;
  const entry = map.get(baseName);
  if (!entry) return null;
  return { minFloat: entry.minFloat, maxFloat: entry.maxFloat };
};
