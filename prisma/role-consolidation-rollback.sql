-- Roll back prisma/role-consolidation.sql for users captured by its backup.
-- Run only while the previous application/schema version is deployed.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "role" = 'ADMIN'::"Role"
      AND "id" NOT IN (SELECT "userId" FROM "_RoleConsolidationBackup")
  ) THEN
    RAISE EXCEPTION 'Rollback refused: Admin users created after consolidation must be migrated manually first';
  END IF;
END $$;

UPDATE "User" AS u
SET "role" = b."legacyRole"::"Role"
FROM "_RoleConsolidationBackup" AS b
WHERE u."id" = b."userId";

DROP TABLE IF EXISTS "_RoleConsolidationBackup";

COMMIT;
