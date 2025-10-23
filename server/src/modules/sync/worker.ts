import type { BackoffStrategy } from "bullmq";
import { Worker } from "bullmq";
import { redisConnection } from "../../queues/connection";
import {
  catalogSyncQueue,
  processCatalogSyncJob,
  type CatalogSyncJobData,
  type CatalogSyncJob,
  type CatalogSyncJobName,
} from "./service";
import { RateLimitError } from "../../lib/http";

const getRetryAfterMs = (err: unknown): number | undefined => {
  if (err instanceof RateLimitError) {
    return err.retryAfterMs;
  }
  if (typeof (err as { retryAfterMs?: unknown })?.retryAfterMs === "number") {
    return (err as { retryAfterMs: number }).retryAfterMs;
  }
  return undefined;
};

const rateLimitBackoff: BackoffStrategy = (attemptsMade, _type, err) => {
  const retryAfterMs = getRetryAfterMs(err);
  if (typeof retryAfterMs === "number") {
    return Math.min(retryAfterMs, 5 * 60_000);
  }
  const base = 2000 * Math.pow(2, Math.max(0, attemptsMade - 1));
  return Math.min(base, 60_000);
};

export const startCatalogSyncWorker = () => {
  const concurrency = Math.max(1, Number(process.env.CATALOG_SYNC_CONCURRENCY || 1));

  const worker = new Worker<CatalogSyncJobData, unknown, CatalogSyncJobName>(
    catalogSyncQueue.name,
    async (job) => processCatalogSyncJob(job as CatalogSyncJob),
    {
      connection: redisConnection,
      concurrency,
      settings: {
        backoffStrategy: rateLimitBackoff,
      },
    },
  );

  let resumeTimer: NodeJS.Timeout | null = null;

  worker.on("error", (error) => {
    console.error("Catalog sync worker error", error);
  });

  worker.on("failed", (job, err) => {
    const retryAfterMs = getRetryAfterMs(err);
    if (retryAfterMs == null) return;

    const delay = Math.min(Math.max(retryAfterMs, 1000), 5 * 60_000);
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
      } catch (resumeError) {
        console.error("Failed to resume catalog sync worker", resumeError);
      }
    }, delay);
  });

  return { worker };
};
