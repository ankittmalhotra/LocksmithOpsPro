-- Additive migration for the server-side RingCentral call cache.
-- Run once against the production PostgreSQL database before deploying code
-- that reads or writes the cache. Re-running this file is safe.

CREATE TABLE IF NOT EXISTS "RingCentralPhoneNumber" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceId" TEXT,
  "accountId" TEXT,
  "extensionId" TEXT,
  "phoneNumber" TEXT NOT NULL,
  "phoneNumberNormalized" TEXT NOT NULL,
  "extensionNumber" TEXT,
  "name" TEXT,
  "type" TEXT,
  "usageType" TEXT,
  "status" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "rawPayload" JSONB NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RingCentralPhoneNumber_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RingCentralCallLog" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceId" TEXT,
  "accountId" TEXT,
  "sessionId" TEXT,
  "telephonySessionId" TEXT,
  "direction" TEXT,
  "type" TEXT,
  "action" TEXT,
  "result" TEXT,
  "reason" TEXT,
  "transport" TEXT,
  "startTime" TIMESTAMP(3),
  "lastModifiedTime" TIMESTAMP(3),
  "durationSeconds" INTEGER,
  "durationMs" INTEGER,
  "callerPhoneNumber" TEXT,
  "callerPhoneNumberNormalized" TEXT,
  "callerExtensionNumber" TEXT,
  "callerName" TEXT,
  "destinationPhoneNumber" TEXT,
  "destinationPhoneNumberNormalized" TEXT,
  "destinationExtensionNumber" TEXT,
  "destinationName" TEXT,
  "trackedDestinationId" TEXT,
  "rawPayload" JSONB NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RingCentralCallLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RingCentralCallLog_trackedDestinationId_fkey"
    FOREIGN KEY ("trackedDestinationId")
    REFERENCES "RingCentralPhoneNumber"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "RingCentralCallSyncState" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "phoneNumberId" TEXT,
  "syncType" TEXT NOT NULL DEFAULT 'CALL_LOG',
  "status" TEXT NOT NULL DEFAULT 'IDLE',
  "cursor" TEXT,
  "windowStart" TIMESTAMP(3),
  "windowEnd" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastError" TEXT,
  "recordsFetched" INTEGER NOT NULL DEFAULT 0,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RingCentralCallSyncState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RingCentralCallSyncState_phoneNumberId_fkey"
    FOREIGN KEY ("phoneNumberId")
    REFERENCES "RingCentralPhoneNumber"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "rc_phone_source_key_key"
  ON "RingCentralPhoneNumber"("sourceKey");
CREATE UNIQUE INDEX IF NOT EXISTS "rc_phone_account_normalized_key"
  ON "RingCentralPhoneNumber"("accountId", "phoneNumberNormalized");
CREATE INDEX IF NOT EXISTS "rc_phone_active_normalized_idx"
  ON "RingCentralPhoneNumber"("active", "phoneNumberNormalized");
CREATE INDEX IF NOT EXISTS "rc_phone_account_active_idx"
  ON "RingCentralPhoneNumber"("accountId", "active");

CREATE UNIQUE INDEX IF NOT EXISTS "rc_call_source_key_key"
  ON "RingCentralCallLog"("sourceKey");
CREATE INDEX IF NOT EXISTS "rc_call_start_time_idx"
  ON "RingCentralCallLog"("startTime");
CREATE INDEX IF NOT EXISTS "rc_call_destination_start_idx"
  ON "RingCentralCallLog"("destinationPhoneNumberNormalized", "startTime");
CREATE INDEX IF NOT EXISTS "rc_call_caller_start_idx"
  ON "RingCentralCallLog"("callerPhoneNumberNormalized", "startTime");
CREATE INDEX IF NOT EXISTS "rc_call_phone_number_start_idx"
  ON "RingCentralCallLog"("trackedDestinationId", "startTime");
CREATE INDEX IF NOT EXISTS "rc_call_telephony_session_idx"
  ON "RingCentralCallLog"("telephonySessionId");

CREATE UNIQUE INDEX IF NOT EXISTS "rc_sync_source_key_key"
  ON "RingCentralCallSyncState"("sourceKey");
CREATE INDEX IF NOT EXISTS "rc_sync_phone_type_idx"
  ON "RingCentralCallSyncState"("phoneNumberId", "syncType");
CREATE INDEX IF NOT EXISTS "rc_sync_status_attempt_idx"
  ON "RingCentralCallSyncState"("status", "lastAttemptAt");
CREATE INDEX IF NOT EXISTS "rc_sync_last_success_idx"
  ON "RingCentralCallSyncState"("lastSuccessAt");

-- This application accesses these tables only through its server-side Prisma
-- connection. Remove default/public and Supabase browser-role privileges while
-- leaving the table owner and any explicitly granted Prisma role untouched.
REVOKE ALL PRIVILEGES ON TABLE
  "RingCentralCallLog",
  "RingCentralPhoneNumber",
  "RingCentralCallSyncState"
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE "RingCentralCallLog", "RingCentralPhoneNumber", "RingCentralCallSyncState" FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE "RingCentralCallLog", "RingCentralPhoneNumber", "RingCentralCallSyncState" FROM authenticated';
  END IF;
END
$$;

ALTER TABLE "RingCentralCallLog" ADD COLUMN IF NOT EXISTS "action" TEXT;
ALTER TABLE "RingCentralCallLog" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "RingCentralCallLog" ADD COLUMN IF NOT EXISTS "transport" TEXT;
ALTER TABLE "RingCentralCallLog" ADD COLUMN IF NOT EXISTS "lastModifiedTime" TIMESTAMP(3);
ALTER TABLE "RingCentralCallLog" ADD COLUMN IF NOT EXISTS "isVoicemail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RingCentralCallLog" ADD COLUMN IF NOT EXISTS "voicemailMessageId" TEXT;
ALTER TABLE "RingCentralCallLog" ADD COLUMN IF NOT EXISTS "voicemailTranscriptionStatus" TEXT;
ALTER TABLE "RingCentralCallLog" ADD COLUMN IF NOT EXISTS "voicemailTranscript" TEXT;
ALTER TABLE "RingCentralCallLog" ADD COLUMN IF NOT EXISTS "voicemailReadStatus" TEXT;
ALTER TABLE "RingCentralCallLog" ADD COLUMN IF NOT EXISTS "voicemailMessageStatus" TEXT;
ALTER TABLE "RingCentralCallLog" ADD COLUMN IF NOT EXISTS "voicemailDurationSeconds" INTEGER;
ALTER TABLE "RingCentralCallSyncState" ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "rc_call_voicemail_idx"
  ON "RingCentralCallLog"("isVoicemail", "startTime");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rc_sync_type_check') THEN
    ALTER TABLE "RingCentralCallSyncState"
      ADD CONSTRAINT "rc_sync_type_check" CHECK ("syncType" IN ('CALL_LOG'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rc_sync_status_check') THEN
    ALTER TABLE "RingCentralCallSyncState"
      ADD CONSTRAINT "rc_sync_status_check" CHECK ("status" IN ('IDLE', 'RUNNING', 'ERROR'));
  END IF;
END
$$;
