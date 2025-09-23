import { Router } from "express";
import {
  calculateTradeup,
  getCollectionsCatalog,
  type TradeupRequestPayload,
} from "./service";

const parseBody = (body: any): TradeupRequestPayload => {
  const inputs = Array.isArray(body?.inputs) ? body.inputs : [];
  const targetCollectionIds = Array.isArray(body?.targetCollectionIds)
    ? body.targetCollectionIds
    : [];
  const options = body?.options && typeof body.options === "object" ? body.options : undefined;
  return {
    inputs: inputs
      .slice(0, 10)
      .map((slot: any) => ({
        marketHashName: String(slot?.marketHashName || ""),
        float: Number(slot?.float ?? 0),
        collectionId: String(slot?.collectionId || ""),
        priceOverrideNet:
          slot?.priceOverrideNet == null ? undefined : Number(slot.priceOverrideNet),
      }))
      .filter((slot: any) => slot.marketHashName && slot.collectionId),
    targetCollectionIds: targetCollectionIds.map((id: any) => String(id)).slice(0, 20),
    options: options,
  };
};

export const createTradeupsRouter = () => {
  const router = Router();

  router.get("/collections", (_request, response) => {
    const collections = getCollectionsCatalog();
    response.json({ collections });
  });

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
