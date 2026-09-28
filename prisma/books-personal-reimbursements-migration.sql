-- Personal-paid expense and reimbursement support. Additive and rerunnable.
BEGIN;

DO $$ BEGIN CREATE TYPE "AccountingExpenseFundingSource" AS ENUM ('BUSINESS', 'PERSONAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AccountingMappingStatus" AS ENUM ('NOT_REVIEWED', 'NEEDS_CLARIFICATION', 'MAPPED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE "AccountingExpensePaymentMethod" ADD VALUE IF NOT EXISTS 'CHEQUE';

ALTER TABLE "AccountingEntityMembership" ADD COLUMN IF NOT EXISTS "canMapAccounting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AccountingEntityMembership" ADD COLUMN IF NOT EXISTS "canManageReimbursements" BOOLEAN NOT NULL DEFAULT false;
UPDATE "AccountingEntityMembership" m
SET "canManageReimbursements" = true
FROM "AccountingEntity" e, "User" u
WHERE m."entityId" = e."id" AND m."userId" = u."id"
  AND e."code" = 'LOCKSMITH' AND u."role" = 'DISPATCHER';
UPDATE "AccountingEntityMembership" m
SET "canMapAccounting" = true, "canManageExpenses" = false, "canManageReimbursements" = false
FROM "User" u
WHERE m."userId" = u."id" AND u."role" = 'ACCOUNTANT';

ALTER TABLE "AccountingExpense"
  ADD COLUMN IF NOT EXISTS "businessPaymentReference" TEXT,
  ADD COLUMN IF NOT EXISTS "fundingSource" "AccountingExpenseFundingSource" NOT NULL DEFAULT 'BUSINESS',
  ADD COLUMN IF NOT EXISTS "personalPayeeName" TEXT,
  ADD COLUMN IF NOT EXISTS "personalPaymentMethod" "AccountingExpensePaymentMethod",
  ADD COLUMN IF NOT EXISTS "personalCardLast4" TEXT,
  ADD COLUMN IF NOT EXISTS "paidBeforeIncorporation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "legacyFundingBackfillApplied" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "mappingStatus" "AccountingMappingStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
  ADD COLUMN IF NOT EXISTS "mappingAccountName" TEXT,
  ADD COLUMN IF NOT EXISTS "mappingAccountCode" TEXT,
  ADD COLUMN IF NOT EXISTS "mappingNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "mappedById" TEXT,
  ADD COLUMN IF NOT EXISTS "mappedAt" TIMESTAMP(3);

-- Legacy expense entries were confirmed by the owner as paid from a personal
-- credit card ending 8833. Do not guess the payer or original payment date.
-- Mark processed rows so rerunning this migration never sweeps up later rows;
-- all new expense API writes also set this marker true.
UPDATE "AccountingExpense"
SET "fundingSource" = 'PERSONAL',
    "personalPaymentMethod" = 'CREDIT_CARD',
    "personalCardLast4" = '8833',
    "personalPayeeName" = NULL,
    "paidAt" = NULL,
    "legacyFundingBackfillApplied" = true
WHERE "legacyFundingBackfillApplied" IS NULL;
ALTER TABLE "AccountingExpense" ALTER COLUMN "legacyFundingBackfillApplied" SET DEFAULT true;
ALTER TABLE "AccountingExpense" ALTER COLUMN "legacyFundingBackfillApplied" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "AccountingExpense_id_entityId_key" ON "AccountingExpense" ("id", "entityId");
CREATE INDEX IF NOT EXISTS "AccountingExpense_entityId_fundingSource_personalPayeeName_idx" ON "AccountingExpense" ("entityId", "fundingSource", "personalPayeeName");
CREATE INDEX IF NOT EXISTS "AccountingExpense_entityId_mappingStatus_idx" ON "AccountingExpense" ("entityId", "mappingStatus");
DO $$ BEGIN ALTER TABLE "AccountingExpense" ADD CONSTRAINT "AccountingExpense_mappedById_fkey" FOREIGN KEY ("mappedById") REFERENCES "User"("id"); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AccountingReimbursementPayment" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "entityId" TEXT NOT NULL,
  "payeeName" TEXT NOT NULL,
  "paymentDate" DATE NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paymentMethod" "AccountingExpensePaymentMethod" NOT NULL,
  "sourceAccountLabel" TEXT,
  "bankReference" TEXT,
  "note" TEXT,
  "proofStorageKey" TEXT,
  "proofFileName" TEXT,
  "proofMimeType" TEXT,
  "proofSize" INTEGER,
  "createdById" TEXT NOT NULL,
  "voidedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "voidReason" TEXT,
  "mappingStatus" "AccountingMappingStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
  "mappingAccountName" TEXT,
  "mappingAccountCode" TEXT,
  "mappingNotes" TEXT,
  "mappedById" TEXT,
  "mappedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingReimbursementPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountingReimbursementPayment_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "AccountingEntity"("id") ON DELETE RESTRICT,
  CONSTRAINT "AccountingReimbursementPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id"),
  CONSTRAINT "AccountingReimbursementPayment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id"),
  CONSTRAINT "AccountingReimbursementPayment_mappedById_fkey" FOREIGN KEY ("mappedById") REFERENCES "User"("id"),
  CONSTRAINT "AccountingReimbursementPayment_amount_check" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "AccountingReimbursementPayment_id_entityId_key" ON "AccountingReimbursementPayment" ("id", "entityId");
CREATE INDEX IF NOT EXISTS "AccountingReimbursementPayment_entityId_paymentDate_idx" ON "AccountingReimbursementPayment" ("entityId", "paymentDate");
CREATE INDEX IF NOT EXISTS "AccountingReimbursementPayment_entityId_payeeName_voidedAt_idx" ON "AccountingReimbursementPayment" ("entityId", "payeeName", "voidedAt");
CREATE INDEX IF NOT EXISTS "AccountingReimbursementPayment_entityId_mappingStatus_idx" ON "AccountingReimbursementPayment" ("entityId", "mappingStatus");

CREATE TABLE IF NOT EXISTS "AccountingReimbursementAllocation" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "entityId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingReimbursementAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountingReimbursementAllocation_payment_entity_fkey" FOREIGN KEY ("paymentId", "entityId") REFERENCES "AccountingReimbursementPayment"("id", "entityId") ON DELETE RESTRICT,
  CONSTRAINT "AccountingReimbursementAllocation_expense_entity_fkey" FOREIGN KEY ("expenseId", "entityId") REFERENCES "AccountingExpense"("id", "entityId") ON DELETE RESTRICT,
  CONSTRAINT "AccountingReimbursementAllocation_amount_check" CHECK ("amount" > 0)
);
CREATE INDEX IF NOT EXISTS "AccountingReimbursementAllocation_entityId_expenseId_idx" ON "AccountingReimbursementAllocation" ("entityId", "expenseId");
CREATE INDEX IF NOT EXISTS "AccountingReimbursementAllocation_entityId_paymentId_idx" ON "AccountingReimbursementAllocation" ("entityId", "paymentId");

COMMIT;
