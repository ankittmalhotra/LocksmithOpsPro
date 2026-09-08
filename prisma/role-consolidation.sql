-- Phase 1 role consolidation for existing PostgreSQL/Supabase databases.
--
-- This migration is intentionally additive. Run the ALTER TYPE statement and
-- allow it to commit before running the data update below. The legacy enum
-- labels remain in PostgreSQL so the rollback script can restore the exact
-- original role for every user that existed at migration time.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMIN';

BEGIN;

CREATE TABLE IF NOT EXISTS "_RoleConsolidationBackup" (
  "userId" TEXT PRIMARY KEY,
  "legacyRole" TEXT NOT NULL CHECK ("legacyRole" IN ('SUPER_ADMIN', 'OWNER')),
  "backedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "_RoleConsolidationBackup" ("userId", "legacyRole")
SELECT "id", "role"::TEXT
FROM "User"
WHERE "role"::TEXT IN ('SUPER_ADMIN', 'OWNER')
ON CONFLICT ("userId") DO NOTHING;

UPDATE "User"
SET "role" = 'ADMIN'
WHERE "role"::TEXT IN ('SUPER_ADMIN', 'OWNER');

COMMIT;
