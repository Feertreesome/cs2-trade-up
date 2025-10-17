import { PrismaClient } from "@prisma/client";

/**
 * Shared Prisma client instance. In development we reuse the instance via global scope
 * to avoid exhausting connection pools during hot reloads.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG_LEVEL === "debug" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type PrismaTransaction = Parameters<PrismaClient["$transaction"]>[0];
