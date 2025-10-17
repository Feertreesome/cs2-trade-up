import { Worker } from "bullmq";
import { redisConnection } from "../../queues/connection";
import {
  catalogSyncQueue,
  processCatalogSyncJob,
  type CatalogSyncJobData,
  type CatalogSyncJob,
  type CatalogSyncJobName,
} from "./service";

export const startCatalogSyncWorker = () => {
  const concurrency = Math.max(1, Number(process.env.CATALOG_SYNC_CONCURRENCY || 1));

  const worker = new Worker<CatalogSyncJobData, void, CatalogSyncJobName>(
    catalogSyncQueue.name,
    async (job) => processCatalogSyncJob(job as CatalogSyncJob),
    {
      connection: redisConnection,
      concurrency,
    },
  );

  worker.on("error", (error) => {
    console.error("Catalog sync worker error", error);
  });

  return { worker };
};
