-- Locksmith-only issuer correction supplied by the business.
-- This intentionally does not change IT_MARKETING.
DO $$
DECLARE affected_rows INTEGER;
BEGIN
  UPDATE "AccountingEntity"
  SET "hstRegistrationNumber" = '702291725RT0001',
      "hstEffectiveDate" = DATE '2026-01-01',
      "hstEnabled" = TRUE,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "code" = 'LOCKSMITH';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows = 0 THEN
    RAISE EXCEPTION 'LOCKSMITH AccountingEntity row is missing; run the seed/bootstrap first, then apply this migration.';
  END IF;
END $$;
