-- CreateEnum
CREATE TYPE "CatalogSyncJobStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "CatalogSyncJob" (
    "id" TEXT NOT NULL,
    "status" "CatalogSyncJobStatus" NOT NULL DEFAULT 'pending',
    "triggered_by" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "error" TEXT,
    "progress" JSONB,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_sync_job_status_created_at_idx" ON "CatalogSyncJob"("status", "created_at");
