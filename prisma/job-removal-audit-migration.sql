-- Apply before deploying the Admin job-removal action.
CREATE TABLE IF NOT EXISTS "JobRemovalAudit" (
  "jobId" TEXT NOT NULL PRIMARY KEY,
  "jobNumber" TEXT NOT NULL,
  "removedById" TEXT,
  "reason" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "removedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
