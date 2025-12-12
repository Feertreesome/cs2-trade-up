"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const skins_1 = require("./modules/skins");
const tradeups_1 = require("./modules/tradeups");
const repo_1 = require("./modules/steam/repo");
/**
 * Точка входа API: здесь только то, что нужно SkinsBrowserComponent.
 * Включает JSON-парсер и CORS, монтирует /api/skins и батч для цен.
 */
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "128kb" }));
// Основной модуль с /api/skins*
app.use("/api/skins", (0, skins_1.createSkinsRouter)());
app.use("/api/tradeups", (0, tradeups_1.createTradeupsRouter)());
// Подготавливаем справочники trade-up каталога при старте сервера.
(0, tradeups_1.warmTradeupCatalog)();
/**
 * POST /api/priceoverview/batch
 * Пакетный эндпоинт для получения цен по market_hash_name.
 * Работает последовательно, дополнительная очередь уже внутри steam/repo.
 */
app.post("/api/priceoverview/batch", async (request, response) => {
    try {
        const names = Array.isArray(request.body?.names)
            ? request.body.names.slice(0, 200).map((n) => String(n))
            : [];
        if (!names.length)
            return response.status(400).json({ error: "names[] required" });
        const prices = {};
        const errors = {};
        const concurrency = 5;
        for (let i = 0; i < names.length; i += concurrency) {
            const slice = names.slice(i, i + concurrency);
            const batch = await Promise.all(slice.map((name) => (0, repo_1.getPriceUSD)(String(name))));
            slice.forEach((name, idx) => {
                const { price, error } = batch[idx];
                prices[name] = price;
                if (error)
                    errors[name] = error;
            });
        }
        return response.json({ prices, errors });
    }
    catch (error) {
        return response.status(500).json({ error: String(error) });
    }
});
const PORT = Number(process.env.PORT || 5174);
app.listen(PORT, () => console.log(`API running on :${PORT}`));
