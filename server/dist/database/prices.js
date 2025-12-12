"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordPriceSnapshot = void 0;
const client_1 = require("./client");
/**
 * Persists the latest price snapshot for a market_hash_name if it exists in the catalog.
 * Failures are swallowed because price history should never break the request flow.
 */
const recordPriceSnapshot = async (marketHashName, priceUsd) => {
    try {
        await client_1.prisma.skin.update({
            where: { marketHashName },
            data: {
                lastKnownPrice: priceUsd ?? null,
                lastPriceAt: new Date(),
                priceSnapshots: {
                    create: {
                        priceUsd: priceUsd ?? null,
                    },
                },
            },
            select: { id: true },
        });
    }
    catch (error) {
        // Ignore errors: either the item is not synchronized yet or constraints failed.
    }
};
exports.recordPriceSnapshot = recordPriceSnapshot;
