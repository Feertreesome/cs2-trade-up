"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCatalogSyncWorker = void 0;
const bullmq_1 = require("bullmq");
const connection_1 = require("../../queues/connection");
const service_1 = require("./service");
const startCatalogSyncWorker = () => {
    const concurrency = Math.max(1, Number(process.env.CATALOG_SYNC_CONCURRENCY || 1));
    const worker = new bullmq_1.Worker(service_1.catalogSyncQueue.name, async (job) => (0, service_1.processCatalogSyncJob)(job), {
        connection: connection_1.redisConnection,
        concurrency,
    });
    worker.on("error", (error) => {
        console.error("Catalog sync worker error", error);
    });
    return { worker };
};
exports.startCatalogSyncWorker = startCatalogSyncWorker;
