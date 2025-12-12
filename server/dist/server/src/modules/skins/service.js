"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPersistedNames = exports.getSkinsPage = exports.getTotals = exports.baseFromMarketHash = exports.parseMarketHashExterior = exports.ALL_RARITIES = void 0;
const repo_1 = require("../steam/repo");
const collections_1 = require("../../database/collections");
const status_1 = require("../../database/status");
/** Supported rarities extracted from Steam mapping. */
exports.ALL_RARITIES = Object.keys(repo_1.RARITY_TO_TAG);
/** Extracts exterior from a market_hash_name, defaults to Field-Tested. */
const parseMarketHashExterior = (marketHashName) => {
    const match = marketHashName.match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i);
    return match?.[1] ?? "Field-Tested";
};
exports.parseMarketHashExterior = parseMarketHashExterior;
/** Removes exterior suffix, returning the base item name. */
const baseFromMarketHash = (marketHashName) => marketHashName.replace(/ \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i, "");
exports.baseFromMarketHash = baseFromMarketHash;
/**
 * Fetches total_count for each rarity with minimal requests.
 */
const getTotals = async (rarities, normalOnly) => {
    if (await (0, status_1.isCatalogReady)()) {
        try {
            const stored = await (0, collections_1.getRarityTotalsFromDb)(rarities, normalOnly);
            if (stored) {
                const perRarity = {};
                let sum = 0;
                for (const rarity of rarities) {
                    const count = stored.perRarity[rarity] ?? 0;
                    perRarity[rarity] = count;
                    sum += count;
                }
                return { perRarity, sum };
            }
        }
        catch (error) {
            // fall back to live Steam data
        }
    }
    const perRarity = {};
    let sum = 0;
    const concurrency = 5;
    for (let i = 0; i < rarities.length; i += concurrency) {
        const slice = rarities.slice(i, i + concurrency);
        const totals = await Promise.all(slice.map((rarity) => (0, repo_1.searchByRarity)({ rarity, start: 0, count: 1, normalOnly })));
        slice.forEach((rarity, idx) => {
            const total = totals[idx].total;
            perRarity[rarity] = total;
            sum += total;
        });
    }
    return { perRarity, sum };
};
exports.getTotals = getTotals;
const getSkinsPage = async (options) => {
    const { rarity, start, count, normalOnly } = options;
    if (await (0, status_1.isCatalogReady)()) {
        try {
            const stored = await (0, collections_1.getSkinsPageFromDb)(rarity, start, count, normalOnly);
            if (stored) {
                return stored;
            }
        }
        catch (error) {
            // fall back to live Steam data
        }
    }
    return (0, repo_1.searchByRarity)({ rarity, start, count, normalOnly });
};
exports.getSkinsPage = getSkinsPage;
const getPersistedNames = async (rarity, normalOnly) => {
    if (await (0, status_1.isCatalogReady)()) {
        try {
            const names = await (0, collections_1.getNamesByRarityFromDb)(rarity, normalOnly);
            if (Array.isArray(names)) {
                return names;
            }
        }
        catch (error) {
            // fall back to live Steam data
        }
    }
    return null;
};
exports.getPersistedNames = getPersistedNames;
