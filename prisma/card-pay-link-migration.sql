-- Additive migration for the stable customer card pay page (/pay/<token>).
-- Apply in the production SQL editor before deploying the code that reads it.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "payToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_pay_token_key" ON "Invoice"("payToken");
