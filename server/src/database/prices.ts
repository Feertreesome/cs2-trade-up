import { prisma } from "./client";

/**
 * Persists the latest price snapshot for a market_hash_name if it exists in the catalog.
 * Failures are swallowed because price history should never break the request flow.
 */
export const recordPriceSnapshot = async (
  marketHashName: string,
  priceUsd: number | null,
): Promise<void> => {
  try {
    await prisma.skin.update({
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
  } catch (error) {
    // Ignore errors: either the item is not synchronized yet or constraints failed.
  }
};
