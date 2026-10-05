-- Add auditable links between jobs and cached RingCentral call records.
-- Apply this additive migration before deploying code that reads JobCallMatch.
-- Existing jobs remain unlinked and continue to load normally.

DO $$ BEGIN
  CREATE TYPE "JobCallMatchStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "JobCallMatchMethod" AS ENUM ('MANUAL', 'PHONE_TIME_RULE', 'ADMIN_IMPORT', 'AI_SUGGESTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "JobCallMatchRole" AS ENUM ('ORIGINATING_INBOUND', 'FOLLOW_UP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "JobCallMatch" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "ringCentralCallLogId" TEXT NOT NULL,
  "status" "JobCallMatchStatus" NOT NULL DEFAULT 'SUGGESTED',
  "method" "JobCallMatchMethod" NOT NULL,
  "role" "JobCallMatchRole" NOT NULL DEFAULT 'ORIGINATING_INBOUND',
  "candidatePhoneCanonical" TEXT,
  "rationale" TEXT,
  "reviewedById" TEXT,
  "reviewedByName" TEXT,
  "reviewedByRole" "Role",
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobCallMatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobCallMatch_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobCallMatch_ringCentralCallLogId_fkey"
    FOREIGN KEY ("ringCentralCallLogId") REFERENCES "RingCentralCallLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "JobCallMatch_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- The application uses its server-side database connection for access. Keep
-- the table closed to direct anon/authenticated PostgREST access by default.
ALTER TABLE "JobCallMatch" ENABLE ROW LEVEL SECURITY;

-- Keep reviewer identity after the associated User account is removed.
ALTER TABLE "JobCallMatch"
  ADD COLUMN IF NOT EXISTS "candidatePhoneCanonical" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedByRole" "Role";

CREATE UNIQUE INDEX IF NOT EXISTS "job_call_match_job_call_key"
  ON "JobCallMatch"("jobId", "ringCentralCallLogId");
CREATE INDEX IF NOT EXISTS "job_call_match_job_status_idx"
  ON "JobCallMatch"("jobId", "status");
CREATE INDEX IF NOT EXISTS "job_call_match_call_status_idx"
  ON "JobCallMatch"("ringCentralCallLogId", "status");
CREATE INDEX IF NOT EXISTS "job_call_match_reviewer_time_idx"
  ON "JobCallMatch"("reviewedById", "reviewedAt");

-- Prisma schema cannot express a partial unique index. Keep exactly one
-- confirmed originating inbound call per job while allowing follow-up calls.
CREATE UNIQUE INDEX IF NOT EXISTS "job_call_match_one_confirmed_origin_idx"
  ON "JobCallMatch"("jobId")
  WHERE "role" = 'ORIGINATING_INBOUND' AND "status" = 'CONFIRMED';

-- A RingCentral inbound session can only originate one confirmed job.
CREATE UNIQUE INDEX IF NOT EXISTS "job_call_match_call_one_confirmed_origin_idx"
  ON "JobCallMatch"("ringCentralCallLogId")
  WHERE "role" = 'ORIGINATING_INBOUND' AND "status" = 'CONFIRMED';
