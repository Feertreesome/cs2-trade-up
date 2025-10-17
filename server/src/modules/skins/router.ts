import { Router } from "express";
import type { AxiosError } from "axios";
import { LRUCache } from "lru-cache";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchListingTotalCount } from "../steam/repo";
import { STEAM_PAGE_SIZE } from "../../config";
import { parseBoolean } from "./validators";
import { ALL_RARITIES, getTotals, getSkinsPage, getPersistedNames } from "./service";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const totalsCache = new LRUCache<string, { perRarity: Record<string, number>; sum: number }>({
  max: 100,
  ttl: 1000 * 60 * 5,
});

const totalsCacheKey = (rarities: string[], normalOnly: boolean) =>
  `${rarities.slice().sort().join(",")}:${normalOnly ? "1" : "0"}`;

const getTotalsCached = async (
  rarities: (typeof ALL_RARITIES)[number][],
  normalOnly: boolean,
) => {
  const key = totalsCacheKey(rarities, normalOnly);
  const cached = totalsCache.get(key);
  if (cached) return cached;
  const fresh = await getTotals(rarities, normalOnly);
  totalsCache.set(key, fresh);
  return fresh;
};

const handleError = (res: any, error: unknown) => {
  const status = (error as AxiosError)?.response?.status;
  if (status === 429) {
    return res.status(503).json({ error: "Steam rate limit, retry later" });
  }
  return res.status(500).json({ error: String(error) });
};

/**
 * Конструирует и возвращает Router с маршрутами для работы со скинами.
 */
export const createSkinsRouter = (): Router => {
  const router = Router();
  /**
   * GET /api/skins/totals?rarities=...&normalOnly=1
   * Лёгкий эндпоинт для получения total_count по редкостям.
   */
  router.get("/totals", async (request, response) => {
    try {
      const raritiesParam = String(request.query.rarities ?? "").trim();
      const rarityList = (raritiesParam ? raritiesParam.split(",") : ALL_RARITIES)
        .map((s) => s.trim())
        .filter((s): s is (typeof ALL_RARITIES)[number] => ALL_RARITIES.includes(s as any));
      const normalOnly = parseBoolean(request.query.normalOnly, true);
      if (!rarityList.length) return response.status(400).json({ error: "No valid rarities" });

      const { perRarity, sum } = await getTotalsCached(rarityList, normalOnly);
      return response.json({ rarities: rarityList, totals: perRarity, sum });
    } catch (error) {
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
      if (!ALL_RARITIES.includes(rarity as any)) return response.status(400).json({ error: "Invalid rarity" });
      const start = Math.max(0, parseInt(String(request.query.start ?? "0"), 10));
      const count = Math.max(1, Math.min(30, parseInt(String(request.query.count ?? "30"), 10)));
      const normalOnly = parseBoolean(request.query.normalOnly, true);

      const { items, total } = await getSkinsPage({
        rarity: rarity as (typeof ALL_RARITIES)[number],
        start,
        count,
        normalOnly,
      });
      return response.json({ rarity, start, count: items.length, total, items });
    } catch (error) {
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
      if (!ALL_RARITIES.includes(rarity as any)) {
        return response.status(400).json({ error: "Invalid rarity" });
      }
      const normalOnly = parseBoolean(request.query.normalOnly, true);

      let names = await getPersistedNames(rarity as any, normalOnly);
      if (!names || names.length === 0) {
        names = [];
        let start = 0;
        while (true) {
          try {
            const { items, total } = await getSkinsPage({
              rarity: rarity as (typeof ALL_RARITIES)[number],
              start,
              count: STEAM_PAGE_SIZE,
              normalOnly,
            });
            if (!items.length) break;
            names.push(...items.map((i) => i.market_hash_name));
            start += items.length;
            if (start >= total) break;
          } catch (err) {
            const status = (err as AxiosError)?.response?.status;
            if (status === 429) {
              await sleep(16_000);
              continue;
            }
            throw err;
          }
        }
      }

      const filePath = path.join(process.cwd(), "server", "data", `${rarity}.json`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify({ rarity, names }, null, 2), "utf8");

      return response.json({ rarity, total: names.length, file: filePath, names });
    } catch (error) {
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
      if (!names.length) return response.status(400).json({ error: "names[] required" });

      const result: Record<string, number | null> = {};
      const concurrency = 5;
      for (let i = 0; i < names.length; i += concurrency) {
        const slice = names.slice(i, i + concurrency);
        const totals = await Promise.all(
          slice.map((name: string) => fetchListingTotalCount(String(name))),
        );
        slice.forEach((name: string, idx: number) => {
          result[name] = totals[idx];
        });
      }

      return response.json({ totals: result });
    } catch (error) {
      return handleError(response, error);
    }
  });

  return router;
};
