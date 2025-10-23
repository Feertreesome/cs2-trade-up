import { prisma } from "./client";

interface StatusCache {
  ready: boolean;
  checkedAt: number;
}

let cache: StatusCache | null = null;

const CACHE_TTL_MS = 30_000;

/**
 * Returns true when the persistent catalog is reachable and has at least one skin.
 */
export const isCatalogReady = async (): Promise<boolean> => {
  const now = Date.now();
  if (cache && now - cache.checkedAt < CACHE_TTL_MS) {
    return cache.ready;
  }

  try {
    const count = await prisma.collection.count();
    const ready = count > 0;
    cache = { ready, checkedAt: now };
    return ready;
  } catch (error) {
    cache = { ready: false, checkedAt: now };
    return false;
  }
};

export const markCatalogReady = () => {
  cache = { ready: true, checkedAt: Date.now() };
};

export const invalidateCatalogStatus = () => {
  cache = null;
};
