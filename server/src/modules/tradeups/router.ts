import { Router } from "express";
import {
  calculateTradeup,
  checkTradeupAvailability,
  fetchCollectionInputs,
  fetchCollectionTargets,
  fetchSteamCollections,
  type TradeupAvailabilityRequest,
  type TradeupRequestPayload,
  type TargetRarity,
} from "./service";
import type { Exterior } from "../skins/service";
import {
  requestFullCatalogSync,
  getSyncJobStatus,
  getActiveSyncJob,
  listSyncJobs,
} from "../sync/service";

const parseNumber = (value: any): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeRarityKey = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");

const RARITY_KEY_MAP: Record<string, TargetRarity> = {
  covert: "Covert",
  classified: "Classified",
  restricted: "Restricted",
  milspec: "Mil-Spec",
  milspecgrade: "Mil-Spec",
  industrial: "Industrial",
  industrialgrade: "Industrial",
  consumer: "Consumer",
  consumergrade: "Consumer",
};

const parseTargetRarity = (value: any): TargetRarity => {
  const key = normalizeRarityKey(String(value ?? "Covert"));
  return RARITY_KEY_MAP[key] ?? RARITY_KEY_MAP[key.replace(/grade$/, "")] ?? "Covert";
};

/**
 * Приводит тело запроса к валидной структуре TradeupRequestPayload, фильтруя лишние поля.
 */
const parseBody = (body: any): TradeupRequestPayload => {
  const inputs = Array.isArray(body?.inputs) ? body.inputs : [];
  const targetCollectionIds = Array.isArray(body?.targetCollectionIds)
    ? body.targetCollectionIds
    : [];
  const targetRarity = parseTargetRarity(body?.targetRarity);
  const targetOverridesRaw = Array.isArray(body?.targetOverrides) ? body.targetOverrides : [];

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
    targetRarity,
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

const parseAvailabilityBody = (body: any): TradeupAvailabilityRequest => {
  const outcomeRaw = body?.outcome ?? {};
  const slotsRaw = Array.isArray(body?.slots) ? body.slots : [];

  const slots = slotsRaw
    .map((slot: any, index: number) => {
      const parsedIndex = parseNumber(slot?.index);
      return {
        index: parsedIndex != null ? Math.trunc(parsedIndex) : index,
        marketHashName: String(slot?.marketHashName || "").trim(),
      };
    })
    .filter((slot: { marketHashName: string }) => slot.marketHashName)
    .slice(0, 10);

  const limitValue = parseNumber(body?.limit);
  const targetAverage = parseNumber(body?.targetAverageFloat);

  return {
    outcome: {
      marketHashName: String(outcomeRaw?.marketHashName || "").trim(),
      minFloat: parseNumber(outcomeRaw?.minFloat) ?? null,
      maxFloat: parseNumber(outcomeRaw?.maxFloat) ?? null,
      rollFloat: parseNumber(outcomeRaw?.rollFloat) ?? null,
    },
    slots,
    limit: limitValue,
    targetAverageFloat: targetAverage,
  };
};

/**
 * HTTP-роутер trade-up калькулятора. Используйте его при монтировании Express-приложения.
 */
export const createTradeupsRouter = () => {
  const router = Router();

  /** Живой список коллекций из Steam Community Market. */
  router.get("/collections/steam", async (_request, response) => {
    try {
      const collections = await fetchSteamCollections();
      response.json({ collections });
    } catch (error) {
      response.status(503).json({ error: String(error) });
    }
  });

  router.post("/collections/sync", async (_request, response) => {
    try {
      const job = await requestFullCatalogSync();
      const statusCode = job.status === "pending" || job.status === "running" ? 202 : 200;
      response.status(statusCode).json({ job });
    } catch (error) {
      response.status(500).json({ error: String(error) });
    }
  });

  router.get("/collections/sync", async (_request, response) => {
    try {
      const [active, jobs] = await Promise.all([getActiveSyncJob(), listSyncJobs()]);
      response.json({ active, jobs });
    } catch (error) {
      response.status(500).json({ error: String(error) });
    }
  });

  router.get("/collections/sync/:jobId", async (request, response) => {
    const jobId = String(request.params?.jobId ?? "").trim();
    try {
      const job = jobId ? await getSyncJobStatus(jobId) : undefined;
      if (!job) {
        return response.status(404).json({ error: "job_not_found" });
      }
      return response.json({ job });
    } catch (error) {
      return response.status(500).json({ error: String(error) });
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
      const rarity = parseTargetRarity(request.query?.rarity);
      const result = await fetchCollectionTargets(collectionTag, rarity);
      response.json(result);
    } catch (error) {
      response.status(503).json({ error: String(error) });
    }
  });

  /** Список входов, которыми можно заполнить слоты trade-up'а. */
  router.get("/collections/:collectionTag/inputs", async (request, response) => {
    const collectionTag = String(request.params?.collectionTag ?? "").trim();
    if (!collectionTag) {
      return response.status(400).json({ error: "collectionTag is required" });
    }
    try {
      const targetRarity = parseTargetRarity(request.query?.rarity);
      const result = await fetchCollectionInputs(collectionTag, targetRarity);
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

  router.post("/availability", async (request, response) => {
    try {
      const payload = parseAvailabilityBody(request.body);
      const result = await checkTradeupAvailability(payload);
      response.json(result);
    } catch (error) {
      response.status(400).json({ error: String(error) });
    }
  });

  return router;
};
