"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCatalogSyncWorker = void 0;
const bullmq_1 = require("bullmq");
const connection_1 = require("../../queues/connection");
const service_1 = require("./service");
const http_1 = require("../../lib/http");
const getRetryAfterMs = (err) => {
    if (err instanceof http_1.RateLimitError) {
        return err.retryAfterMs;
    }
    if (typeof err?.retryAfterMs === "number") {
        return err.retryAfterMs;
    }
    return undefined;
};
const rateLimitBackoff = (attemptsMade, _type, err) => {
    const retryAfterMs = getRetryAfterMs(err);
    if (typeof retryAfterMs === "number") {
        return Math.min(retryAfterMs, 5 * 60000);
    }
    const base = 2000 * Math.pow(2, Math.max(0, attemptsMade - 1));
    return Math.min(base, 60000);
};
const startCatalogSyncWorker = () => {
    const concurrency = Math.max(1, Number(process.env.CATALOG_SYNC_CONCURRENCY || 1));
    const worker = new bullmq_1.Worker(service_1.catalogSyncQueue.name, async (job) => (0, service_1.processCatalogSyncJob)(job), {
        connection: connection_1.redisConnection,
        concurrency,
        settings: {
            backoffStrategy: rateLimitBackoff,
        },
    });
    let resumeTimer = null;
    worker.on("error", (error) => {
        console.error("Catalog sync worker error", error);
    });
    worker.on("failed", (job, err) => {
        const retryAfterMs = getRetryAfterMs(err);
        if (retryAfterMs == null)
            return;
        const delay = Math.min(Math.max(retryAfterMs, 1000), 5 * 60000);
        console.warn("Catalog sync rate limited, pausing queue", {
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
            retryAfterMs,
            scheduledDelay: delay,
        });
        if (resumeTimer) {
            clearTimeout(resumeTimer);
            resumeTimer = null;
        }
        void worker.pause(true).catch((pauseError) => {
            console.error("Failed to pause catalog sync worker", pauseError);
        });
        resumeTimer = setTimeout(() => {
            try {
                worker.resume();
            }
            catch (resumeError) {
                console.error("Failed to resume catalog sync worker", resumeError);
            }
        }, delay);
    });
    return { worker };
};
exports.startCatalogSyncWorker = startCatalogSyncWorker;
