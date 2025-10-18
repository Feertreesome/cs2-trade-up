import { Worker } from "bullmq";
import { redisConnection } from "../../queues/connection";
import {
  catalogSyncQueue,
  processCatalogSyncJob,
  type CatalogSyncJobData,
  type CatalogSyncJob,
  type CatalogSyncJobName,
} from "./service";
import { RateLimitError } from "../steam/repo";

export const startCatalogSyncWorker = () => {
  const concurrency = Math.max(1, Number(process.env.CATALOG_SYNC_CONCURRENCY || 1));

  const worker = new Worker<CatalogSyncJobData, void, CatalogSyncJobName>(
    catalogSyncQueue.name,
    async (job) => processCatalogSyncJob(job as CatalogSyncJob),
    {
      connection: redisConnection,
      concurrency,
      backoffStrategy: (attempts, err: any) => {
        const retryAfterMs =
          err instanceof RateLimitError
            ? err.retryAfterMs
            : typeof err?.retryAfterMs === "number"
              ? err.retryAfterMs
              : undefined;
        if (typeof retryAfterMs === "number") {
          return Math.min(retryAfterMs, 5 * 60_000);
        }
        const base = 2000 * Math.pow(2, Math.max(0, attempts - 1));
        return Math.min(base, 60_000);
      },
    },
  );

  let resumeTimer: NodeJS.Timeout | null = null;

  worker.on("error", (error) => {
    console.error("Catalog sync worker error", error);
  });

  worker.on("failed", (job, err) => {
    const retryAfterMs =
      err instanceof RateLimitError
        ? err.retryAfterMs
        : typeof err?.retryAfterMs === "number"
          ? err.retryAfterMs
          : undefined;
    if (retryAfterMs == null) return;

    const delay = Math.min(Math.max(retryAfterMs, 1000), 5 * 60_000);
    console.warn("Catalog sync rate limited, pausing queue", {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      retryAfterMs: retryAfterMs,
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
      void worker.resume().catch((resumeError) => {
        console.error("Failed to resume catalog sync worker", resumeError);
      });
    }, delay);
  });

  return { worker };
};
