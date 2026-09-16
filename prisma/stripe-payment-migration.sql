-- Additive Stripe payment migration.
-- Safe to run more than once against the existing PostgreSQL database.
-- Run this in the production Supabase SQL Editor before deploying the app.

BEGIN;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "customer_stripe_customer_id_key"
  ON "Customer" ("stripeCustomerId");

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "paymentProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeSessionStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeSessionExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stripePaymentUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "stripePaymentLinkCreatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stripePaymentLinkExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stripeInvoiceId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeChargeId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerEmailCollectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "invoiceSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentFailedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_stripe_invoice_id_key"
  ON "Invoice" ("stripeInvoiceId");

CREATE TABLE IF NOT EXISTS "StripeWebhookEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stripe_webhook_event_event_id_key"
  ON "StripeWebhookEvent" ("eventId");

CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_processedAt_idx"
  ON "StripeWebhookEvent" ("processedAt");

COMMIT;
