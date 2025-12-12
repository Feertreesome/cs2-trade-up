"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateCatalogStatus = exports.markCatalogReady = exports.isCatalogReady = void 0;
const client_1 = require("./client");
let cache = null;
const CACHE_TTL_MS = 30000;
/**
 * Returns true when the persistent catalog is reachable and has at least one skin.
 */
const isCatalogReady = async () => {
    const now = Date.now();
    if (cache && now - cache.checkedAt < CACHE_TTL_MS) {
        return cache.ready;
    }
    try {
        const count = await client_1.prisma.collection.count();
        const ready = count > 0;
        cache = { ready, checkedAt: now };
        return ready;
    }
    catch (error) {
        cache = { ready: false, checkedAt: now };
        return false;
    }
};
exports.isCatalogReady = isCatalogReady;
const markCatalogReady = () => {
    cache = { ready: true, checkedAt: Date.now() };
};
exports.markCatalogReady = markCatalogReady;
const invalidateCatalogStatus = () => {
    cache = null;
};
exports.invalidateCatalogStatus = invalidateCatalogStatus;
