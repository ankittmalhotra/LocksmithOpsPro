-- Preserve the dispatcher-provided source message for audit and review.
-- Apply this additive migration before deploying code that reads/writes Job.intakeMessage.
ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "intakeMessage" TEXT;
