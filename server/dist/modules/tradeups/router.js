"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTradeupsRouter = void 0;
const express_1 = require("express");
const service_1 = require("./service");
const service_2 = require("../sync/service");
const parseNumber = (value) => {
    if (value === null || value === undefined || value === "")
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};
/**
 * Приводит тело запроса к валидной структуре TradeupRequestPayload, фильтруя лишние поля.
 */
const parseBody = (body) => {
    const inputs = Array.isArray(body?.inputs) ? body.inputs : [];
    const targetCollectionIds = Array.isArray(body?.targetCollectionIds)
        ? body.targetCollectionIds
        : [];
    const rarityParam = String(body?.targetRarity ?? "Covert").trim().toLowerCase();
    const targetRarity = rarityParam === "classified" ? "Classified" : "Covert";
    const options = body?.options && typeof body.options === "object" ? body.options : undefined;
    const targetOverridesRaw = Array.isArray(body?.targetOverrides) ? body.targetOverrides : [];
    return {
        inputs: inputs
            .slice(0, 10)
            .map((slot) => ({
            marketHashName: String(slot?.marketHashName || ""),
            float: Number(slot?.float ?? 0),
            collectionId: String(slot?.collectionId || ""),
            minFloat: parseNumber(slot?.minFloat),
            maxFloat: parseNumber(slot?.maxFloat),
            priceOverrideNet: slot?.priceOverrideNet == null ? undefined : Number(slot.priceOverrideNet),
        }))
            .filter((slot) => slot.marketHashName && slot.collectionId),
        targetCollectionIds: targetCollectionIds.map((id) => String(id)).slice(0, 20),
        targetRarity,
        options: options,
        targetOverrides: targetOverridesRaw
            .map((override) => ({
            collectionId: override?.collectionId == null || override.collectionId === ""
                ? undefined
                : String(override.collectionId),
            collectionTag: override?.collectionTag == null || override.collectionTag === ""
                ? undefined
                : String(override.collectionTag),
            baseName: String(override?.baseName || ""),
            exterior: typeof override?.exterior === "string" && override.exterior
                ? override.exterior
                : undefined,
            marketHashName: override?.marketHashName == null || override.marketHashName === ""
                ? undefined
                : String(override.marketHashName),
            minFloat: parseNumber(override?.minFloat),
            maxFloat: parseNumber(override?.maxFloat),
            price: parseNumber(override?.price),
        }))
            .filter((override) => override.baseName),
    };
};
const parseAvailabilityBody = (body) => {
    const outcomeRaw = body?.outcome ?? {};
    const slotsRaw = Array.isArray(body?.slots) ? body.slots : [];
    const slots = slotsRaw
        .map((slot, index) => {
        const parsedIndex = parseNumber(slot?.index);
        return {
            index: parsedIndex != null ? Math.trunc(parsedIndex) : index,
            marketHashName: String(slot?.marketHashName || "").trim(),
        };
    })
        .filter((slot) => slot.marketHashName)
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
const createTradeupsRouter = () => {
    const router = (0, express_1.Router)();
    /** Локальный справочник коллекций с подготовленными float-диапазонами. */
    router.get("/collections", (_request, response) => {
        const collections = (0, service_1.getCollectionsCatalog)();
        response.json({ collections });
    });
    /** Живой список коллекций из Steam Community Market. */
    router.get("/collections/steam", async (_request, response) => {
        try {
            const collections = await (0, service_1.fetchSteamCollections)();
            response.json({ collections });
        }
        catch (error) {
            response.status(503).json({ error: String(error) });
        }
    });
    router.post("/collections/sync", async (_request, response) => {
        try {
            const job = await (0, service_2.requestFullCatalogSync)();
            const statusCode = job.status === "pending" || job.status === "running" ? 202 : 200;
            response.status(statusCode).json({ job });
        }
        catch (error) {
            response.status(500).json({ error: String(error) });
        }
    });
    router.get("/collections/sync", async (_request, response) => {
        try {
            const [active, jobs] = await Promise.all([(0, service_2.getActiveSyncJob)(), (0, service_2.listSyncJobs)()]);
            response.json({ active, jobs });
        }
        catch (error) {
            response.status(500).json({ error: String(error) });
        }
    });
    router.get("/collections/sync/:jobId", async (request, response) => {
        const jobId = String(request.params?.jobId ?? "").trim();
        try {
            const job = jobId ? await (0, service_2.getSyncJobStatus)(jobId) : undefined;
            if (!job) {
                return response.status(404).json({ error: "job_not_found" });
            }
            return response.json({ job });
        }
        catch (error) {
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
            const rarityParam = String(request.query?.rarity ?? "Covert").trim();
            const normalized = rarityParam.toLowerCase();
            const rarity = normalized === "classified" ? "Classified" : "Covert";
            const result = await (0, service_1.fetchCollectionTargets)(collectionTag, rarity);
            response.json(result);
        }
        catch (error) {
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
            const rarityParam = String(request.query?.rarity ?? "Covert").trim();
            const normalized = rarityParam.toLowerCase();
            const targetRarity = normalized === "classified" ? "Classified" : "Covert";
            const result = await (0, service_1.fetchCollectionInputs)(collectionTag, targetRarity);
            response.json(result);
        }
        catch (error) {
            response.status(503).json({ error: String(error) });
        }
    });
    /** Запускает расчёт EV и распределения исходов. */
    router.post("/calculate", async (request, response) => {
        try {
            const payload = parseBody(request.body);
            const result = await (0, service_1.calculateTradeup)(payload);
            response.json(result);
        }
        catch (error) {
            response.status(400).json({ error: String(error) });
        }
    });
    router.post("/availability", async (request, response) => {
        try {
            const payload = parseAvailabilityBody(request.body);
            const result = await (0, service_1.checkTradeupAvailability)(payload);
            response.json(result);
        }
        catch (error) {
            response.status(400).json({ error: String(error) });
        }
    });
    return router;
};
exports.createTradeupsRouter = createTradeupsRouter;
