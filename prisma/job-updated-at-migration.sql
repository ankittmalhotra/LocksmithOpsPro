-- Add the optimistic-concurrency token used by dispatcher job edits.
-- Run this once against the production PostgreSQL database before deploying
-- the application code that reads/writes Job.updatedAt.
ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
