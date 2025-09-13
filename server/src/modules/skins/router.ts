import { Router } from "express";
import type { AxiosError } from "axios";
import { LRUCache } from "lru-cache";
import fs from "node:fs/promises";
import path from "node:path";
import { getPriceUSD, searchByRarity, fetchListingTotalCount } from "../steam/repo";
import { STEAM_MAX_AUTO_LIMIT, STEAM_PAGE_SIZE } from "../../config";
import { parseBoolean } from "./validators";
import {
  ALL_RARITIES,
  baseFromMarketHash,
  getTotals,
  parseMarketHashExterior,
} from "./service";
import {
  EXTERIORS,
  type Exterior,
  type ExpandMode,
  type SkinsGroup,
} from "./types";

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
   * GET /api/skins
   * Возвращает список предметов по редкостям, с возможной агрегацией по базовому имени.
   * query:
   *  - rarities=Classified,Covert         (по умолчанию — все доступные)
   *  - limit=500 | auto | all             (auto/all тянут максимум, но с безопасным капом)
   *  - aggregate=1|0                      (группировать экстерьеры предмета)
   *  - prices=1|0                         (подтягивать цены)
   *  - normalOnly=1|0                     (исключить ST/Souvenir)
   *  - withTotals=1                       (вернуть totals в meta)
   *  - expandExteriors=none|price|all     (дополнять отсутствующие экстерьеры)
   */
  router.get("/", async (request, response) => {
    try {
      const raritiesParam = String(request.query.rarities ?? "").trim();
      const rarityList = (raritiesParam ? raritiesParam.split(",") : ALL_RARITIES)
        .map((s) => s.trim())
        .filter((s): s is (typeof ALL_RARITIES)[number] => ALL_RARITIES.includes(s as any));

      if (!rarityList.length) {
        return response.status(400).json({ error: `No valid rarities. Allowed: ${ALL_RARITIES.join(", ")}` });
      }

      const aggregate = parseBoolean(request.query.aggregate, true);
      const includePrices = parseBoolean(request.query.prices, false);
      const normalOnly = parseBoolean(request.query.normalOnly, true);
      const withTotals = parseBoolean(request.query.withTotals, false);
      const expandMode = String(request.query.expandExteriors || "none").toLowerCase() as ExpandMode;

      const limitRaw = String(request.query.limit ?? "500").toLowerCase();
      let limitNumber: number;
      let meta: any = null;

      if (["all", "auto", "max"].includes(limitRaw)) {
        const totals = await getTotalsCached(rarityList, normalOnly);
        const recommended = totals.sum;
        limitNumber = Math.min(recommended, STEAM_MAX_AUTO_LIMIT);
        meta = {
          totals: totals.perRarity,
          recommendedLimit: recommended,
          appliedLimit: limitNumber,
          capped: recommended > STEAM_MAX_AUTO_LIMIT
        };
      } else {
        const raw = Number.parseInt(String(request.query.limit ?? "500"), 10);
        limitNumber = Number.isFinite(raw) ? Math.min(5000, Math.max(1, raw)) : 500;
        if (withTotals) {
          const totals = await getTotalsCached(rarityList, normalOnly);
          meta = {
            totals: totals.perRarity,
            recommendedLimit: totals.sum,
            appliedLimit: limitNumber,
            capped: false
          };
        }
      }

      const perRarityLimit = Math.max(1, Math.floor(limitNumber / rarityList.length));
      const pageSize = STEAM_PAGE_SIZE;

      const flatItems: { market_hash_name: string; sell_listings: number; rarity: string }[] = [];

      // Пагинация по каждой редкости
      for (const rarity of rarityList) {
        let start = 0;
        while (true) {
          const already = flatItems.filter((x) => x.rarity === rarity).length;
          const need = perRarityLimit - already;
          if (need <= 0) break;

          const batch = Math.min(pageSize, need);
          const { items, total } = await searchByRarity({ rarity, start, count: batch, normalOnly });
          if (!items.length) break;

          flatItems.push(...items.map((i) => ({ ...i, rarity })));
          start += items.length;
          if (start >= total) break;
        }
      }

      // Неагрегированный режим — просто вернём плоский список
      if (!aggregate) {
        if (includePrices) {
          await Promise.all(
            flatItems.map(async (it) => {
              (it as any).price = await getPriceUSD(it.market_hash_name);
            })
          );
        }
        return response.json({ rarities: rarityList, total: flatItems.length, items: flatItems, meta });
      }

      // Агрегация по базовому имени
      const groupedSkins: Record<string, SkinsGroup> = {};
      const priceTasks: Array<{ groupKey: string; idx: number }> = [];

      for (const item of flatItems) {
        const marketHashName = item.market_hash_name;
        const baseName = baseFromMarketHash(marketHashName);
        const exterior = parseMarketHashExterior(marketHashName);
        const key = `${item.rarity}::${baseName}`;

        if (!groupedSkins[key]) groupedSkins[key] = { baseName, rarity: item.rarity, exteriors: [] };
        const entry = { exterior, marketHashName, sell_listings: item.sell_listings, price: null as number | null };
        groupedSkins[key].exteriors.push(entry);
        if (includePrices) priceTasks.push({ groupKey: key, idx: groupedSkins[key].exteriors.length - 1 });
      }

      // Дополняем отсутствующие экстерьеры по выбранному режиму
      type Group = (typeof groupedSkins)[string];
      const priceChecks: Array<{ key: string; marketHashName: string; exterior: Exterior }> = [];

      for (const [key, group] of Object.entries(groupedSkins) as [string, Group][]) {
        const present = new Set(group.exteriors.map((e) => e.exterior));
        if (expandMode === "all") {
          for (const exterior of EXTERIORS) {
            if (present.has(exterior)) continue;
            const mhn = `${group.baseName} (${exterior})`;
            const entry = { exterior, marketHashName: mhn, sell_listings: 0, price: null as number | null };
            group.exteriors.push(entry);
            if (includePrices) priceTasks.push({ groupKey: key, idx: group.exteriors.length - 1 });
          }
        } else if (expandMode === "price") {
          for (const exterior of EXTERIORS) {
            if (present.has(exterior)) continue;
            const mhn = `${group.baseName} (${exterior})`;
            priceChecks.push({ key, marketHashName: mhn, exterior });
          }
        }
      }

      // В режиме "price" — добавляем только те экстерьеры, на которые Steam отдал цену
      if (expandMode === "price") {
        for (const check of priceChecks) {
          const price = await getPriceUSD(check.marketHashName);
          if (price == null) continue;
          const group = groupedSkins[check.key];
          const entry = { exterior: check.exterior, marketHashName: check.marketHashName, sell_listings: 0, price: includePrices ? price : null };
          group.exteriors.push(entry);
          if (includePrices && entry.price == null) {
            priceTasks.push({ groupKey: check.key, idx: group.exteriors.length - 1 });
          }
        }
      }

      // Дотягиваем цены для тех, кому ещё не поставили
      if (includePrices && priceTasks.length) {
        await Promise.all(
          priceTasks.map(async ({ groupKey, idx }) => {
            const group = groupedSkins[groupKey];
            const e = group.exteriors[idx];
            if (e.price == null) e.price = await getPriceUSD(e.marketHashName);
          })
        );
      }

      // Уточняем реальные количества для «нулевых» экстерьеров
      const namesNeedingTotals = Object.values(groupedSkins)
        .flatMap((g) => g.exteriors.filter((e) => e.sell_listings === 0).map((e) => e.marketHashName));
      const uniqueNames = Array.from(new Set(namesNeedingTotals)).slice(0, 150);
      const concurrency = 5;
      for (let i = 0; i < uniqueNames.length; i += concurrency) {
        const slice = uniqueNames.slice(i, i + concurrency);
        const totals = await Promise.all(slice.map((name) => fetchListingTotalCount(name)));
        slice.forEach((name, idx) => {
          const n = totals[idx];
          if (typeof n === "number") {
            for (const g of Object.values(groupedSkins)) {
              for (const e of g.exteriors) {
                if (e.marketHashName === name && e.sell_listings === 0) e.sell_listings = n;
              }
            }
          }
        });
      }

      const skins = Object.values(groupedSkins).sort((a, b) => a.baseName.localeCompare(b.baseName));
      return response.json({ rarities: rarityList, total: skins.length, skins, meta });
    } catch (error) {
      return handleError(response, error);
    }
  });

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

      const { items, total } = await searchByRarity({ rarity: rarity as any, start, count, normalOnly });
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

      const names: string[] = [];
      let start = 0;
      while (true) {
        try {
          const { items, total } = await searchByRarity({
            rarity: rarity as any,
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
          slice.map((name) => fetchListingTotalCount(String(name))),
        );
        slice.forEach((name, idx) => {
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
