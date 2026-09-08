-- Apply after prisma/role-consolidation.sql on an existing PostgreSQL/Supabase database.
-- This migration is additive and safe to re-run.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'DEBIT_CARD';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CREDIT_CARD';

ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "isManual" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "totalAmountCollected" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS "taxCollected" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "cogsAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0;

-- Existing invoice totals represent amounts collected. Preserve that meaning for
-- historical records before the new explicit field was introduced.
UPDATE "Invoice"
SET "totalAmountCollected" = "grandTotal"
WHERE "totalAmountCollected" = 0.0 AND "grandTotal" <> 0.0;
