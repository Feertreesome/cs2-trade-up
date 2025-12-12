"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSkinsRouter = void 0;
const express_1 = require("express");
const lru_cache_1 = require("lru-cache");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const repo_1 = require("../steam/repo");
const config_1 = require("../../config");
const validators_1 = require("./validators");
const service_1 = require("./service");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const totalsCache = new lru_cache_1.LRUCache({
    max: 100,
    ttl: 1000 * 60 * 5,
});
const totalsCacheKey = (rarities, normalOnly) => `${rarities.slice().sort().join(",")}:${normalOnly ? "1" : "0"}`;
const getTotalsCached = async (rarities, normalOnly) => {
    const key = totalsCacheKey(rarities, normalOnly);
    const cached = totalsCache.get(key);
    if (cached)
        return cached;
    const fresh = await (0, service_1.getTotals)(rarities, normalOnly);
    totalsCache.set(key, fresh);
    return fresh;
};
const handleError = (res, error) => {
    const status = error?.response?.status;
    if (status === 429) {
        return res.status(503).json({ error: "Steam rate limit, retry later" });
    }
    return res.status(500).json({ error: String(error) });
};
/**
 * Конструирует и возвращает Router с маршрутами для работы со скинами.
 */
const createSkinsRouter = () => {
    const router = (0, express_1.Router)();
    /**
     * GET /api/skins/totals?rarities=...&normalOnly=1
     * Лёгкий эндпоинт для получения total_count по редкостям.
     */
    router.get("/totals", async (request, response) => {
        try {
            const raritiesParam = String(request.query.rarities ?? "").trim();
            const rarityList = (raritiesParam ? raritiesParam.split(",") : service_1.ALL_RARITIES)
                .map((s) => s.trim())
                .filter((s) => service_1.ALL_RARITIES.includes(s));
            const normalOnly = (0, validators_1.parseBoolean)(request.query.normalOnly, true);
            if (!rarityList.length)
                return response.status(400).json({ error: "No valid rarities" });
            const { perRarity, sum } = await getTotalsCached(rarityList, normalOnly);
            return response.json({ rarities: rarityList, totals: perRarity, sum });
        }
        catch (error) {
            return handleError(response, error);
        }
    });
    /**
     * GET /api/skins/paged?rarity=Classified&start=0&count=30&normalOnly=1
     * Безопасная постраничная выборка одной редкости (для прогрессивной загрузки).
     */
    router.get("/paged", async (request, response) => {
        try {
            const rarity = String(request.query.rarity ?? "");
            if (!service_1.ALL_RARITIES.includes(rarity))
                return response.status(400).json({ error: "Invalid rarity" });
            const start = Math.max(0, parseInt(String(request.query.start ?? "0"), 10));
            const count = Math.max(1, Math.min(30, parseInt(String(request.query.count ?? "30"), 10)));
            const normalOnly = (0, validators_1.parseBoolean)(request.query.normalOnly, true);
            const { items, total } = await (0, service_1.getSkinsPage)({
                rarity: rarity,
                start,
                count,
                normalOnly,
            });
            return response.json({ rarity, start, count: items.length, total, items });
        }
        catch (error) {
            return handleError(response, error);
        }
    });
    /**
     * GET /api/skins/names?rarity=Classified&normalOnly=1
     * Выгружает все market_hash_name указанной редкости и сохраняет в JSON.
     */
    router.get("/names", async (request, response) => {
        try {
            const rarity = String(request.query.rarity ?? "");
            if (!service_1.ALL_RARITIES.includes(rarity)) {
                return response.status(400).json({ error: "Invalid rarity" });
            }
            const normalOnly = (0, validators_1.parseBoolean)(request.query.normalOnly, true);
            let names = await (0, service_1.getPersistedNames)(rarity, normalOnly);
            if (!names || names.length === 0) {
                names = [];
                let start = 0;
                while (true) {
                    try {
                        const { items, total } = await (0, service_1.getSkinsPage)({
                            rarity: rarity,
                            start,
                            count: config_1.STEAM_PAGE_SIZE,
                            normalOnly,
                        });
                        if (!items.length)
                            break;
                        names.push(...items.map((i) => i.market_hash_name));
                        start += items.length;
                        if (start >= total)
                            break;
                    }
                    catch (err) {
                        const status = err?.response?.status;
                        if (status === 429) {
                            await sleep(16000);
                            continue;
                        }
                        throw err;
                    }
                }
            }
            const filePath = node_path_1.default.join(process.cwd(), "server", "data", `${rarity}.json`);
            await promises_1.default.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
            await promises_1.default.writeFile(filePath, JSON.stringify({ rarity, names }, null, 2), "utf8");
            return response.json({ rarity, total: names.length, file: filePath, names });
        }
        catch (error) {
            return handleError(response, error);
        }
    });
    /**
     * POST /api/skins/listing-totals
     * Принимает names[] = market_hash_name[] и возвращает точные количества листингов.
     */
    router.post("/listing-totals", async (request, response) => {
        try {
            const names = Array.isArray(request.body?.names)
                ? request.body.names.slice(0, 150)
                : [];
            if (!names.length)
                return response.status(400).json({ error: "names[] required" });
            const result = {};
            const concurrency = 5;
            for (let i = 0; i < names.length; i += concurrency) {
                const slice = names.slice(i, i + concurrency);
                const totals = await Promise.all(slice.map((name) => (0, repo_1.fetchListingTotalCount)(String(name))));
                slice.forEach((name, idx) => {
                    result[name] = totals[idx];
                });
            }
            return response.json({ totals: result });
        }
        catch (error) {
            return handleError(response, error);
        }
    });
    return router;
};
exports.createSkinsRouter = createSkinsRouter;
