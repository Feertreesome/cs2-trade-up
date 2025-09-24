import { Router } from "express";
import {
  calculateTradeup,
  fetchCollectionInputs,
  fetchCollectionTargets,
  fetchSteamCollections,
  getCollectionsCatalog,
  type TradeupRequestPayload,
} from "./service";
import type { Exterior } from "../skins/service";

/**
 * Приводит тело запроса к валидной структуре TradeupRequestPayload, фильтруя лишние поля.
 */
const parseBody = (body: any): TradeupRequestPayload => {
  const inputs = Array.isArray(body?.inputs) ? body.inputs : [];
  const targetCollectionIds = Array.isArray(body?.targetCollectionIds)
    ? body.targetCollectionIds
    : [];
  const options = body?.options && typeof body.options === "object" ? body.options : undefined;
  const targetOverridesRaw = Array.isArray(body?.targetOverrides) ? body.targetOverrides : [];

  const parseNumber = (value: any) => {
    if (value === null || value === undefined || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return {
    inputs: inputs
      .slice(0, 10)
      .map((slot: any) => ({
        marketHashName: String(slot?.marketHashName || ""),
        float: Number(slot?.float ?? 0),
        collectionId: String(slot?.collectionId || ""),
        minFloat: parseNumber(slot?.minFloat),
        maxFloat: parseNumber(slot?.maxFloat),
        priceOverrideNet:
          slot?.priceOverrideNet == null ? undefined : Number(slot.priceOverrideNet),
      }))
      .filter((slot: any) => slot.marketHashName && slot.collectionId),
    targetCollectionIds: targetCollectionIds.map((id: any) => String(id)).slice(0, 20),
    options: options,
    targetOverrides: targetOverridesRaw
      .map((override: any) => ({
        collectionId:
          override?.collectionId == null || override.collectionId === ""
            ? undefined
            : String(override.collectionId),
        collectionTag:
          override?.collectionTag == null || override.collectionTag === ""
            ? undefined
            : String(override.collectionTag),
        baseName: String(override?.baseName || ""),
        exterior:
          typeof override?.exterior === "string" && override.exterior
            ? (override.exterior as Exterior)
            : undefined,
        marketHashName:
          override?.marketHashName == null || override.marketHashName === ""
            ? undefined
            : String(override.marketHashName),
        minFloat: parseNumber(override?.minFloat),
        maxFloat: parseNumber(override?.maxFloat),
        price: parseNumber(override?.price),
      }))
      .filter((override: any) => override.baseName),
  };
};

/**
 * HTTP-роутер trade-up калькулятора. Используйте его при монтировании Express-приложения.
 */
export const createTradeupsRouter = () => {
  const router = Router();

  /** Локальный справочник коллекций с подготовленными float-диапазонами. */
  router.get("/collections", (_request, response) => {
    const collections = getCollectionsCatalog();
    response.json({ collections });
  });

  /** Живой список коллекций из Steam Community Market. */
  router.get("/collections/steam", async (_request, response) => {
    try {
      const collections = await fetchSteamCollections();
      response.json({ collections });
    } catch (error) {
      response.status(503).json({ error: String(error) });
    }
  });

  /**
   * Детализация Covert-результатов по выбранной коллекции. Нужна для выбора цели на клиенте.
   */
  router.get("/collections/:collectionTag/targets", async (request, response) => {
    const collectionTag = String(request.params?.collectionTag ?? "").trim();
    if (!collectionTag) {
      return response.status(400).json({ error: "collectionTag is required" });
    }
    try {
      const result = await fetchCollectionTargets(collectionTag);
      response.json(result);
    } catch (error) {
      response.status(503).json({ error: String(error) });
    }
  });

  /** Список Classified-входов, которыми можно заполнить слоты trade-up'а. */
  router.get("/collections/:collectionTag/inputs", async (request, response) => {
    const collectionTag = String(request.params?.collectionTag ?? "").trim();
    if (!collectionTag) {
      return response.status(400).json({ error: "collectionTag is required" });
    }
    try {
      const result = await fetchCollectionInputs(collectionTag);
      response.json(result);
    } catch (error) {
      response.status(503).json({ error: String(error) });
    }
  });

  /** Запускает расчёт EV и распределения исходов. */
  router.post("/calculate", async (request, response) => {
    try {
      const payload = parseBody(request.body);
      const result = await calculateTradeup(payload);
      response.json(result);
    } catch (error) {
      response.status(400).json({ error: String(error) });
    }
  });

  return router;
};
