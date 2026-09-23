-- Additive Books/accounting migration. Run once in the production PostgreSQL
-- SQL editor before deploying the Books routes. Every statement is repeatable.
BEGIN;

-- The Books accountant role is additive to existing deployments.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';

DO $$ BEGIN CREATE TYPE "AccountingEntityCode" AS ENUM ('IT_MARKETING', 'LOCKSMITH'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AccountingExpensePaymentStatus" AS ENUM ('UNPAID', 'PAID'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AccountingExpensePaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'INTERAC', 'CREDIT_CARD', 'DEBIT_CARD', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AccountingExpenseReceiptStatus" AS ENUM ('ATTACHED', 'MISSING', 'NOT_REQUIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AccountingReceiptDraftStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED', 'CONSUMED', 'EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PartnerBillingPeriodStatus" AS ENUM ('OPEN', 'CARRIED_FORWARD', 'INVOICED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PartnerInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PartnerInvoicePaymentStatus" AS ENUM ('PENDING', 'RECEIVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PartnerInvoiceKind" AS ENUM ('PARTNER_SERVICE', 'CUSTOMER_SERVICE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AccountingEntityAuditAction" AS ENUM ('CREATED', 'UPDATED', 'RECEIPT_PARSED', 'ISSUED', 'VOIDED', 'PAYMENT_STATUS_CHANGED', 'MARKED_PAID', 'MARKED_UNPAID', 'EMAIL_SENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE "AccountingEntityAuditAction" ADD VALUE IF NOT EXISTS 'RECEIPT_PARSED';
ALTER TYPE "AccountingEntityAuditAction" ADD VALUE IF NOT EXISTS 'EMAIL_SENT';

CREATE TABLE IF NOT EXISTS "AccountingEntity" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(), "code" "AccountingEntityCode" NOT NULL, "legalName" TEXT NOT NULL,
  "corporationNumber" TEXT, "email" TEXT, "addressLine1" TEXT, "city" TEXT, "province" TEXT, "postalCode" TEXT,
  "country" TEXT NOT NULL DEFAULT 'Canada', "authorizedPersonName" TEXT, "authorizedPersonTitle" TEXT,
  "hstRegistrationNumber" TEXT, "hstEffectiveDate" DATE, "hstEnabled" BOOLEAN NOT NULL DEFAULT false,
  "currency" TEXT NOT NULL DEFAULT 'CAD', "partnerBillingAnchor" DATE NOT NULL, "nextPartnerInvoiceNumber" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingEntity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AccountingEntity_code_key" ON "AccountingEntity" ("code");
CREATE INDEX IF NOT EXISTS "AccountingEntity_legalName_idx" ON "AccountingEntity" ("legalName");

CREATE TABLE IF NOT EXISTS "AccountingEntityMembership" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(), "userId" TEXT NOT NULL, "entityId" TEXT NOT NULL,
  "canView" BOOLEAN NOT NULL DEFAULT true, "canManageExpenses" BOOLEAN NOT NULL DEFAULT false, "canIssueInvoices" BOOLEAN NOT NULL DEFAULT false, "canMarkPayments" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingEntityMembership_pkey" PRIMARY KEY ("id"), CONSTRAINT "AccountingEntityMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE, CONSTRAINT "AccountingEntityMembership_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "AccountingEntity"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AccountingEntityMembership_userId_entityId_key" ON "AccountingEntityMembership" ("userId", "entityId");
CREATE INDEX IF NOT EXISTS "AccountingEntityMembership_entityId_canView_idx" ON "AccountingEntityMembership" ("entityId", "canView");

CREATE TABLE IF NOT EXISTS "AccountingExpenseCategory" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(), "entityId" TEXT NOT NULL, "name" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingExpenseCategory_pkey" PRIMARY KEY ("id"), CONSTRAINT "AccountingExpenseCategory_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "AccountingEntity"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AccountingExpenseCategory_entityId_name_key" ON "AccountingExpenseCategory" ("entityId", "name");
CREATE INDEX IF NOT EXISTS "AccountingExpenseCategory_entityId_active_idx" ON "AccountingExpenseCategory" ("entityId", "active");

CREATE TABLE IF NOT EXISTS "AccountingExpense" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(), "entityId" TEXT NOT NULL, "categoryId" TEXT, "vendorName" TEXT NOT NULL, "description" TEXT,
  "expenseDate" DATE NOT NULL, "subtotalAmount" DECIMAL(12,2) NOT NULL, "hstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0, "totalAmount" DECIMAL(12,2) NOT NULL,
  "hstRate" DECIMAL(5,4), "paymentStatus" "AccountingExpensePaymentStatus" NOT NULL DEFAULT 'UNPAID', "paymentMethod" "AccountingExpensePaymentMethod", "paidAt" TIMESTAMP(3),
  "receiptUrl" TEXT, "notes" TEXT, "createdById" TEXT NOT NULL, "updatedById" TEXT, "voidedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingExpense_pkey" PRIMARY KEY ("id"), CONSTRAINT "AccountingExpense_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "AccountingEntity"("id") ON DELETE CASCADE, CONSTRAINT "AccountingExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AccountingExpenseCategory"("id") ON DELETE SET NULL, CONSTRAINT "AccountingExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id"), CONSTRAINT "AccountingExpense_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id")
);
ALTER TABLE "AccountingExpense" ADD COLUMN IF NOT EXISTS "businessPurpose" TEXT;
ALTER TABLE "AccountingExpense" ADD COLUMN IF NOT EXISTS "receiptStatus" "AccountingExpenseReceiptStatus" NOT NULL DEFAULT 'MISSING';
ALTER TABLE "AccountingExpense" ADD COLUMN IF NOT EXISTS "receiptStorageKey" TEXT;
ALTER TABLE "AccountingExpense" ADD COLUMN IF NOT EXISTS "receiptFileName" TEXT;
ALTER TABLE "AccountingExpense" ADD COLUMN IF NOT EXISTS "receiptMimeType" TEXT;
ALTER TABLE "AccountingExpense" ADD COLUMN IF NOT EXISTS "receiptSize" INTEGER;
ALTER TABLE "AccountingExpense" ADD COLUMN IF NOT EXISTS "receiptUploadedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "AccountingExpense_entityId_expenseDate_idx" ON "AccountingExpense" ("entityId", "expenseDate");
CREATE INDEX IF NOT EXISTS "AccountingExpense_entityId_paymentStatus_idx" ON "AccountingExpense" ("entityId", "paymentStatus");
CREATE INDEX IF NOT EXISTS "AccountingExpense_entityId_receiptStatus_idx" ON "AccountingExpense" ("entityId", "receiptStatus");
CREATE INDEX IF NOT EXISTS "AccountingExpense_categoryId_idx" ON "AccountingExpense" ("categoryId");

CREATE TABLE IF NOT EXISTS "AccountingReceiptDraft" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(), "entityId" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL, "fileName" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL,
  "extractedData" JSONB, "warnings" JSONB, "confidence" JSONB, "model" TEXT,
  "status" "AccountingReceiptDraftStatus" NOT NULL DEFAULT 'PROCESSING', "errorMessage" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingReceiptDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountingReceiptDraft_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "AccountingEntity"("id") ON DELETE CASCADE,
  CONSTRAINT "AccountingReceiptDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "AccountingReceiptDraft_entityId_status_idx" ON "AccountingReceiptDraft" ("entityId", "status");
CREATE INDEX IF NOT EXISTS "AccountingReceiptDraft_createdById_status_idx" ON "AccountingReceiptDraft" ("createdById", "status");
CREATE INDEX IF NOT EXISTS "AccountingReceiptDraft_expiresAt_idx" ON "AccountingReceiptDraft" ("expiresAt");

CREATE TABLE IF NOT EXISTS "PartnerBillingPeriod" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(), "issuerEntityId" TEXT NOT NULL, "recipientEntityId" TEXT NOT NULL, "periodStart" DATE NOT NULL, "periodEnd" DATE NOT NULL,
  "status" "PartnerBillingPeriodStatus" NOT NULL DEFAULT 'OPEN', "revenueAmount" DECIMAL(12,2) NOT NULL, "hstDeductedAmount" DECIMAL(12,2) NOT NULL, "cogsAmount" DECIMAL(12,2) NOT NULL, "technicianCommissionsAmount" DECIMAL(12,2) NOT NULL, "operationalProfitAmount" DECIMAL(12,2) NOT NULL,
  "priorNegativeCarryForward" DECIMAL(12,2) NOT NULL DEFAULT 0, "adjustedProfitAmount" DECIMAL(12,2) NOT NULL, "negativeCarryForward" DECIMAL(12,2) NOT NULL DEFAULT 0, "shareRate" DECIMAL(5,4) NOT NULL DEFAULT 0.5, "partnerFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0, "hstRate" DECIMAL(5,4) NOT NULL DEFAULT 0, "hstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sourceSnapshot" JSONB, "calculationNote" TEXT, "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerBillingPeriod_pkey" PRIMARY KEY ("id"), CONSTRAINT "PartnerBillingPeriod_issuerEntityId_fkey" FOREIGN KEY ("issuerEntityId") REFERENCES "AccountingEntity"("id"), CONSTRAINT "PartnerBillingPeriod_recipientEntityId_fkey" FOREIGN KEY ("recipientEntityId") REFERENCES "AccountingEntity"("id"), CONSTRAINT "PartnerBillingPeriod_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerBillingPeriod_recipientEntityId_periodStart_periodEnd_key" ON "PartnerBillingPeriod" ("recipientEntityId", "periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "PartnerBillingPeriod_issuerEntityId_periodStart_idx" ON "PartnerBillingPeriod" ("issuerEntityId", "periodStart");
CREATE INDEX IF NOT EXISTS "PartnerBillingPeriod_recipientEntityId_periodStart_idx" ON "PartnerBillingPeriod" ("recipientEntityId", "periodStart");
CREATE INDEX IF NOT EXISTS "PartnerBillingPeriod_status_idx" ON "PartnerBillingPeriod" ("status");

CREATE TABLE IF NOT EXISTS "PartnerInvoice" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(), "billingPeriodId" TEXT, "issuerEntityId" TEXT NOT NULL, "recipientEntityId" TEXT, "invoiceNumber" TEXT NOT NULL,
  "invoiceKind" "PartnerInvoiceKind" NOT NULL DEFAULT 'PARTNER_SERVICE', "status" "PartnerInvoiceStatus" NOT NULL DEFAULT 'DRAFT', "paymentStatus" "PartnerInvoicePaymentStatus" NOT NULL DEFAULT 'PENDING', "lineDescription" TEXT NOT NULL, "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1, "serviceAmount" DECIMAL(12,2) NOT NULL, "hstRate" DECIMAL(5,4) NOT NULL DEFAULT 0, "hstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0, "totalAmount" DECIMAL(12,2) NOT NULL, "currency" TEXT NOT NULL DEFAULT 'CAD', "periodStart" DATE, "periodEnd" DATE, "issuedAt" TIMESTAMP(3), "dueAt" TIMESTAMP(3), "hstRegistrationSnapshot" TEXT, "issuerSnapshot" JSONB NOT NULL, "recipientSnapshot" JSONB NOT NULL, "paymentTerms" TEXT, "notes" TEXT, "emailSentAt" TIMESTAMP(3), "emailSentTo" TEXT, "emailMessageId" TEXT, "issuedById" TEXT, "voidedById" TEXT, "voidedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerInvoice_pkey" PRIMARY KEY ("id"), CONSTRAINT "PartnerInvoice_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "PartnerBillingPeriod"("id"), CONSTRAINT "PartnerInvoice_issuerEntityId_fkey" FOREIGN KEY ("issuerEntityId") REFERENCES "AccountingEntity"("id"), CONSTRAINT "PartnerInvoice_recipientEntityId_fkey" FOREIGN KEY ("recipientEntityId") REFERENCES "AccountingEntity"("id"), CONSTRAINT "PartnerInvoice_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id"), CONSTRAINT "PartnerInvoice_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id")
);
ALTER TABLE "PartnerInvoice" ALTER COLUMN "billingPeriodId" DROP NOT NULL;
ALTER TABLE "PartnerInvoice" ALTER COLUMN "recipientEntityId" DROP NOT NULL;
ALTER TABLE "PartnerInvoice" ALTER COLUMN "periodStart" DROP NOT NULL;
ALTER TABLE "PartnerInvoice" ALTER COLUMN "periodEnd" DROP NOT NULL;
ALTER TABLE "PartnerInvoice" ADD COLUMN IF NOT EXISTS "invoiceKind" "PartnerInvoiceKind" NOT NULL DEFAULT 'PARTNER_SERVICE';
ALTER TABLE "PartnerInvoice" ADD COLUMN IF NOT EXISTS "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1;
ALTER TABLE "PartnerInvoice" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT;
ALTER TABLE "PartnerInvoice" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "PartnerInvoice" ADD COLUMN IF NOT EXISTS "emailSentAt" TIMESTAMP(3);
ALTER TABLE "PartnerInvoice" ADD COLUMN IF NOT EXISTS "emailSentTo" TEXT;
ALTER TABLE "PartnerInvoice" ADD COLUMN IF NOT EXISTS "emailMessageId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerInvoice_billingPeriodId_key" ON "PartnerInvoice" ("billingPeriodId");
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerInvoice_invoiceNumber_key" ON "PartnerInvoice" ("invoiceNumber");
CREATE INDEX IF NOT EXISTS "PartnerInvoice_issuerEntityId_issuedAt_idx" ON "PartnerInvoice" ("issuerEntityId", "issuedAt");
CREATE INDEX IF NOT EXISTS "PartnerInvoice_recipientEntityId_issuedAt_idx" ON "PartnerInvoice" ("recipientEntityId", "issuedAt");
CREATE INDEX IF NOT EXISTS "PartnerInvoice_recipientEntityId_paymentStatus_idx" ON "PartnerInvoice" ("recipientEntityId", "paymentStatus");

CREATE TABLE IF NOT EXISTS "PartnerInvoicePaymentEvent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(), "invoiceId" TEXT NOT NULL, "fromStatus" "PartnerInvoicePaymentStatus" NOT NULL, "toStatus" "PartnerInvoicePaymentStatus" NOT NULL, "amount" DECIMAL(12,2) NOT NULL, "paidAt" TIMESTAMP(3), "paymentMethod" TEXT, "reference" TEXT, "note" TEXT, "recordedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerInvoicePaymentEvent_pkey" PRIMARY KEY ("id"), CONSTRAINT "PartnerInvoicePaymentEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PartnerInvoice"("id") ON DELETE RESTRICT, CONSTRAINT "PartnerInvoicePaymentEvent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id")
);
CREATE INDEX IF NOT EXISTS "PartnerInvoicePaymentEvent_invoiceId_createdAt_idx" ON "PartnerInvoicePaymentEvent" ("invoiceId", "createdAt");

CREATE TABLE IF NOT EXISTS "AccountingAuditEvent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(), "entityId" TEXT, "invoiceId" TEXT, "actorId" TEXT NOT NULL, "action" "AccountingEntityAuditAction" NOT NULL, "resourceType" TEXT NOT NULL, "resourceId" TEXT NOT NULL, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingAuditEvent_pkey" PRIMARY KEY ("id"), CONSTRAINT "AccountingAuditEvent_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "AccountingEntity"("id") ON DELETE SET NULL, CONSTRAINT "AccountingAuditEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PartnerInvoice"("id") ON DELETE SET NULL, CONSTRAINT "AccountingAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id")
);
CREATE INDEX IF NOT EXISTS "AccountingAuditEvent_entityId_createdAt_idx" ON "AccountingAuditEvent" ("entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "AccountingAuditEvent_resourceType_resourceId_createdAt_idx" ON "AccountingAuditEvent" ("resourceType", "resourceId", "createdAt");
CREATE INDEX IF NOT EXISTS "AccountingAuditEvent_invoiceId_createdAt_idx" ON "AccountingAuditEvent" ("invoiceId", "createdAt");

-- Bootstrap the fixed entities and grant existing staff the access described
-- by the application. This makes the migration complete on an existing
-- production database; rerunning it is safe because all writes are upserts.
INSERT INTO "AccountingEntity" ("code", "legalName", "corporationNumber", "email", "addressLine1", "city", "province", "postalCode", "country", "authorizedPersonName", "authorizedPersonTitle", "hstRegistrationNumber", "partnerBillingAnchor")
VALUES
  ('IT_MARKETING', '1001744934 ONTARIO INC.', '1001744934', NULL, NULL, NULL, 'Ontario', NULL, 'Canada', NULL, NULL, '752857771RT0001', DATE '2026-09-07'),
  ('LOCKSMITH', '1001348245 ONTARIO INC.', '1001348245', 'bcltoronto1@gmail.com', '27 Knollside Drive', 'Richmond Hill', 'Ontario', 'L4C4W7', 'Canada', 'UMAR QURESHI', 'Director', NULL, DATE '2026-09-07')
ON CONFLICT ("code") DO UPDATE SET
  "legalName" = EXCLUDED."legalName",
  "corporationNumber" = EXCLUDED."corporationNumber",
  "email" = COALESCE("AccountingEntity"."email", EXCLUDED."email"),
  "addressLine1" = COALESCE("AccountingEntity"."addressLine1", EXCLUDED."addressLine1"),
  "city" = COALESCE("AccountingEntity"."city", EXCLUDED."city"),
  "province" = COALESCE("AccountingEntity"."province", EXCLUDED."province"),
  "postalCode" = COALESCE("AccountingEntity"."postalCode", EXCLUDED."postalCode"),
  "authorizedPersonName" = COALESCE("AccountingEntity"."authorizedPersonName", EXCLUDED."authorizedPersonName"),
  "authorizedPersonTitle" = COALESCE("AccountingEntity"."authorizedPersonTitle", EXCLUDED."authorizedPersonTitle"),
  "hstRegistrationNumber" = CASE WHEN EXCLUDED."code" = 'IT_MARKETING' THEN EXCLUDED."hstRegistrationNumber" ELSE "AccountingEntity"."hstRegistrationNumber" END;

INSERT INTO "AccountingEntityMembership" ("userId", "entityId", "canView", "canManageExpenses", "canIssueInvoices", "canMarkPayments")
SELECT u."id", e."id", true, true, true, true
FROM "User" u CROSS JOIN "AccountingEntity" e
WHERE u."role" = 'ADMIN' AND u."active" = true
ON CONFLICT ("userId", "entityId") DO UPDATE SET
  "canView" = true, "canManageExpenses" = true, "canIssueInvoices" = true, "canMarkPayments" = true;

INSERT INTO "AccountingEntityMembership" ("userId", "entityId", "canView", "canManageExpenses", "canIssueInvoices", "canMarkPayments")
SELECT u."id", e."id", true, true, false, false
FROM "User" u CROSS JOIN "AccountingEntity" e
WHERE u."role" = 'DISPATCHER' AND u."active" = true AND e."code" = 'LOCKSMITH'
ON CONFLICT ("userId", "entityId") DO UPDATE SET
  "canView" = true, "canManageExpenses" = true;

COMMIT;
