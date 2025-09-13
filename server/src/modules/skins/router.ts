import { Router } from "express";
import { RARITY_TO_TAG, getPriceUSD, searchByRarity, fetchListingTotalCount } from "../steam/repo";
import { STEAM_MAX_AUTO_LIMIT, STEAM_PAGE_SIZE } from "../../config";

/** Поддерживаемые редкости в виде кортежа для валидации. */
const ALL_RARITIES = Object.keys(RARITY_TO_TAG) as (keyof typeof RARITY_TO_TAG)[];

/** Экстерьеры в заданном порядке (нужны для сортировки). */
const EXTERIORS = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"] as const;
type Exterior = typeof EXTERIORS[number];

type ExpandMode = "none" | "price" | "all";

/** Булевый парсер query-параметров с дефолтом. */
const parseBoolean = (value: unknown, defaultValue = false) => {
  const text = String(value ?? "");
  if (/^(1|true|yes|on)$/i.test(text)) return true;
  if (/^(0|false|no|off)$/i.test(text)) return false;
  return defaultValue;
};

/** Из market_hash_name извлекает экстрерьер, по умолчанию FT. */
const parseMarketHashExterior = (marketHashName: string): Exterior => {
  const m = marketHashName.match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i);
  return (m?.[1] as Exterior) ?? "Field-Tested";
};

/** Убирает суффикс экстерьера, получая базовое имя предмета. */
const baseFromMarketHash = (marketHashName: string): string =>
  marketHashName.replace(/ \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i, "");

/**
 * Возвращает объект с total_count по каждой редкости одним лёгким запросом (count=1).
 */
const getTotals = async (rarities: (keyof typeof RARITY_TO_TAG)[], normalOnly: boolean) => {
  const perRarity: Record<string, number> = {};
  let sum = 0;
  for (const rarity of rarities) {
    const { total } = await searchByRarity({ rarity, start: 0, count: 1, normalOnly });
    perRarity[rarity] = total;
    sum += total;
  }
  return { perRarity, sum };
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
        .filter((s): s is keyof typeof RARITY_TO_TAG => (ALL_RARITIES as readonly string[]).includes(s));

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
        const totals = await getTotals(rarityList, normalOnly);
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
          const totals = await getTotals(rarityList, normalOnly);
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

      const flat: { market_hash_name: string; sell_listings: number; rarity: string }[] = [];

      // Пагинация по каждой редкости
      for (const rarity of rarityList) {
        let start = 0;
        while (true) {
          const already = flat.filter((x) => x.rarity === rarity).length;
          const need = perRarityLimit - already;
          if (need <= 0) break;

          const batch = Math.min(pageSize, need);
          const { items, total } = await searchByRarity({ rarity, start, count: batch, normalOnly });
          if (!items.length) break;

          flat.push(...items.map((i) => ({ ...i, rarity })));
          start += items.length;
          if (start >= total) break;
        }
      }

      // Неагрегированный режим — просто вернём плоский список
      if (!aggregate) {
        if (includePrices) {
          await Promise.all(
            flat.map(async (it) => {
              (it as any).price = await getPriceUSD(it.market_hash_name);
            })
          );
        }
        return response.json({ rarities: rarityList, total: flat.length, items: flat, meta });
      }

      // Агрегация по базовому имени
      const groups: Record<
        string,
        {
          baseName: string;
          rarity: string;
          exteriors: { exterior: Exterior; marketHashName: string; sell_listings: number; price: number | null }[];
        }
      > = {};
      const toPrice: Array<{ groupKey: string; idx: number }> = [];

      for (const item of flat) {
        const marketHashName = item.market_hash_name;
        const baseName = baseFromMarketHash(marketHashName);
        const exterior = parseMarketHashExterior(marketHashName);
        const key = `${item.rarity}::${baseName}`;

        if (!groups[key]) groups[key] = { baseName, rarity: item.rarity, exteriors: [] };
        const entry = { exterior, marketHashName, sell_listings: item.sell_listings, price: null as number | null };
        groups[key].exteriors.push(entry);
        if (includePrices) toPrice.push({ groupKey: key, idx: groups[key].exteriors.length - 1 });
      }

      // Дополняем отсутствующие экстерьеры по выбранному режиму
      type Group = (typeof groups)[string];
      const priceChecks: Array<{ key: string; marketHashName: string; exterior: Exterior }> = [];

      for (const [key, group] of Object.entries(groups) as [string, Group][]) {
        const present = new Set(group.exteriors.map((e) => e.exterior));
        if (expandMode === "all") {
          for (const exterior of EXTERIORS) {
            if (present.has(exterior)) continue;
            const mhn = `${group.baseName} (${exterior})`;
            const entry = { exterior, marketHashName: mhn, sell_listings: 0, price: null as number | null };
            group.exteriors.push(entry);
            if (includePrices) toPrice.push({ groupKey: key, idx: group.exteriors.length - 1 });
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
          const group = groups[check.key];
          const entry = { exterior: check.exterior, marketHashName: check.marketHashName, sell_listings: 0, price: includePrices ? price : null };
          group.exteriors.push(entry);
          if (includePrices && entry.price == null) {
            toPrice.push({ groupKey: check.key, idx: group.exteriors.length - 1 });
          }
        }
      }

      // Дотягиваем цены для тех, кому ещё не поставили
      if (includePrices && toPrice.length) {
        await Promise.all(
          toPrice.map(async ({ groupKey, idx }) => {
            const group = groups[groupKey];
            const e = group.exteriors[idx];
            if (e.price == null) e.price = await getPriceUSD(e.marketHashName);
          })
        );
      }

      // Уточняем реальные количества для «нулевых» экстерьеров
      const needTotals = Object.values(groups)
        .flatMap((g) => g.exteriors.filter((e) => e.sell_listings === 0).map((e) => e.marketHashName));
      for (const name of Array.from(new Set(needTotals))) {
        const n = await fetchListingTotalCount(name);
        if (typeof n === "number") {
          for (const g of Object.values(groups)) {
            for (const e of g.exteriors) {
              if (e.marketHashName === name && e.sell_listings === 0) e.sell_listings = n;
            }
          }
        }
      }

      const skins = Object.values(groups).sort((a, b) => a.baseName.localeCompare(b.baseName));
      return response.json({ rarities: rarityList, total: skins.length, skins, meta });
    } catch (error) {
      return response.status(500).json({ error: String(error) });
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
        .filter((s): s is keyof typeof RARITY_TO_TAG => (ALL_RARITIES as any).includes(s));
      const normalOnly = parseBoolean(request.query.normalOnly, true);
      if (!rarityList.length) return response.status(400).json({ error: "No valid rarities" });

      const totals: Record<string, number> = {};
      let sum = 0;
      for (const rarity of rarityList) {
        const { total } = await searchByRarity({ rarity, start: 0, count: 1, normalOnly });
        totals[rarity] = total;
        sum += total;
      }
      return response.json({ rarities: rarityList, totals, sum });
    } catch (error) {
      return response.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /api/skins/paged?rarity=Classified&start=0&count=30&normalOnly=1
   * Безопасная постраничная выборка одной редкости (для прогрессивной загрузки).
   */
  router.get("/paged", async (request, response) => {
    try {
      const rarity = String(request.query.rarity ?? "");
      if (!(ALL_RARITIES as any).includes(rarity)) return response.status(400).json({ error: "Invalid rarity" });
      const start = Math.max(0, parseInt(String(request.query.start ?? "0"), 10));
      const count = Math.max(1, Math.min(30, parseInt(String(request.query.count ?? "30"), 10)));
      const normalOnly = parseBoolean(request.query.normalOnly, true);

      const { items, total } = await searchByRarity({ rarity: rarity as any, start, count, normalOnly });
      return response.json({ rarity, start, count: items.length, total, items });
    } catch (error) {
      return response.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /api/skins/listing-totals
   * Принимает names[] = market_hash_name[] и возвращает точные количества листингов.
   */
  router.post("/listing-totals", async (request, response) => {
    try {
      const names = Array.isArray(request.body?.names) ? request.body.names.slice(0, 150) : [];
      if (!names.length) return response.status(400).json({ error: "names[] required" });

      const result: Record<string, number | null> = {};
      for (const name of names) result[name] = await fetchListingTotalCount(String(name));
      return response.json({ totals: result });
    } catch (error) {
      return response.status(500).json({ error: String(error) });
    }
  });

  return router;
};
