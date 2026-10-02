-- Additive migration for immutable local operational payment receipts.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';
CREATE TABLE "JobPaymentReceipt" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedById" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "pdfBytes" BYTEA NOT NULL,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "replacementId" TEXT,
  CONSTRAINT "JobPaymentReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobPaymentReceipt_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "JobPaymentReceipt_replacementId_fkey"
    FOREIGN KEY ("replacementId") REFERENCES "JobPaymentReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JobPaymentReceipt_receiptNumber_key" ON "JobPaymentReceipt"("receiptNumber");
CREATE UNIQUE INDEX "JobPaymentReceipt_invoiceId_revision_key" ON "JobPaymentReceipt"("invoiceId", "revision");
CREATE UNIQUE INDEX "JobPaymentReceipt_replacementId_key" ON "JobPaymentReceipt"("replacementId");
CREATE INDEX "JobPaymentReceipt_invoiceId_voidedAt_idx" ON "JobPaymentReceipt"("invoiceId", "voidedAt");
CREATE UNIQUE INDEX "JobPaymentReceipt_one_active_per_invoice_key"
  ON "JobPaymentReceipt"("invoiceId") WHERE "voidedAt" IS NULL;
