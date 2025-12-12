"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
/**
 * Shared Prisma client instance. In development we reuse the instance via global scope
 * to avoid exhausting connection pools during hot reloads.
 */
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.prisma ??
    new client_1.PrismaClient({
        log: process.env.PRISMA_LOG_LEVEL === "debug" ? ["query", "error", "warn"] : ["error"],
    });
if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = exports.prisma;
}
