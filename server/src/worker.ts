import "dotenv/config";
import { startCatalogSyncWorker } from "./modules/sync/worker";

const { worker } = startCatalogSyncWorker();

const shutdown = async () => {
  try {
    await Promise.allSettled([worker.close()]);
  } finally {
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
