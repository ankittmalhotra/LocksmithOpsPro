-- Update the Locksmith issuer master record to the business-supplied legal
-- name and address. Existing issued receipt/invoice snapshots are immutable.
DO $$
DECLARE affected_rows INTEGER;
BEGIN
  UPDATE "AccountingEntity"
  SET "legalName" = 'Better Call Locksmith Inc.',
      "corporationNumber" = '1001348245',
      "email" = 'bcltoronto1@gmail.com',
      "addressLine1" = '222 Spadina Avenue, Unit 114',
      "city" = 'Toronto',
      "province" = 'Ontario',
      "postalCode" = 'M5T 3B3',
      "country" = 'Canada',
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "code" = 'LOCKSMITH';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows = 0 THEN
    RAISE EXCEPTION 'LOCKSMITH AccountingEntity row is missing; run the Books bootstrap or seed first.';
  END IF;
END $$;
