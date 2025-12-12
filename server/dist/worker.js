"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const worker_1 = require("./modules/sync/worker");
const { worker } = (0, worker_1.startCatalogSyncWorker)();
const shutdown = async () => {
    try {
        await Promise.allSettled([worker.close()]);
    }
    finally {
        process.exit(0);
    }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
worker.on("completed", (job) => {
    console.log(`Catalog sync job ${job.id} completed`);
});
worker.on("failed", (job, err) => {
    console.error(`Catalog sync job ${job?.id ?? "unknown"} failed`, err);
});
