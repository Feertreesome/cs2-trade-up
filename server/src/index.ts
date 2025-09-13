import express from "express";
import cors from "cors";
import { createSkinsRouter } from "./modules/skins/router";
import { getPriceUSD } from "./modules/steam/repo";

/**
 * Точка входа API: здесь только то, что нужно SkinsBrowserComponent.
 * Включает JSON-парсер и CORS, монтирует /api/skins и батч для цен.
 */
const app = express();
app.use(cors());
app.use(express.json({ limit: "128kb" }));

// Основной модуль с /api/skins*
app.use("/api/skins", createSkinsRouter());

/**
 * POST /api/priceoverview/batch
 * Пакетный эндпоинт для получения цен по market_hash_name.
 * Работает последовательно, дополнительная очередь уже внутри steam/repo.
 */
app.post("/api/priceoverview/batch", async (request, response) => {
  try {
    const names = Array.isArray(request.body?.names) ? request.body.names.slice(0, 200) : [];
    if (!names.length) return response.status(400).json({ error: "names[] required" });

    const prices: Record<string, number | null> = {};
    for (const name of names) prices[name] = await getPriceUSD(String(name));
    return response.json({ prices });
  } catch (error) {
    return response.status(500).json({ error: String(error) });
  }
});

const PORT = Number(process.env.PORT || 5174);
app.listen(PORT, () => console.log(`API running on :${PORT}`));
