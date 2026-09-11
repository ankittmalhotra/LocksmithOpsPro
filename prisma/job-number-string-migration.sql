-- Convert existing PostgreSQL job numbers from int4 to text.
-- Existing values are preserved as their decimal string representation.
ALTER TABLE "Job"
  ALTER COLUMN "jobNumber" TYPE TEXT
  USING "jobNumber"::TEXT;
