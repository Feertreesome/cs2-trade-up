"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const worker_1 = require("./modules/sync/worker");
const http_1 = require("./lib/http"); // ⚠️ добавь, если у тебя уже есть этот класс
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
// ✅ успешное завершение джоба
worker.on("completed", (job) => {
    console.log(`✅ Catalog sync job ${job.id} completed`);
});
// ⚠️ перехват ошибок
worker.on("failed", async (job, err) => {
    // --- 429 / RateLimitError ---
    console.log(err.retryAfterMs, 'err.retryAfterMs=====');
    if (err instanceof http_1.RateLimitError || err?.name === "RateLimitError") {
        const retry = Math.round((err.retryAfterMs ?? 60000) / 1000);
        console.warn(`⚠️  Rate limit (429) for job ${job?.id ?? "unknown"} — retrying in ${retry}s...`);
        // Пауза всей очереди на время Retry-After
        try {
            await worker.pause();
            setTimeout(async () => {
                console.log(`Resuming queue after ${retry}s`);
                worker.resume();
            }, err.retryAfterMs ?? 60000);
        }
        catch (e) {
            console.error("Failed to pause/resume worker", e);
        }
        return; // не логируем как фейл
    }
    // --- Другие мягкие сетевые ошибки ---
    const status = err?.response?.status;
    console.log('ERROR RESPONSE STATUS: ', status);
    if (status === 429 || (status >= 500 && status < 600)) {
        console.warn(`🌐 Temporary error (status ${status}) for job ${job?.id ?? "unknown"} — will retry`);
        return;
    }
    // --- Реальные фейлы ---
    console.error(`❌ Catalog sync job ${job?.id ?? "unknown"} failed:`, err);
});
