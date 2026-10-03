-- Apply to LocksmithOps Pro (kahkbtrotjvyksiileso) using the production
-- SQL editor. Stripe was read only. No receipt or issued Books snapshot changes.
-- Fixed identifiers/amount guards abort the entire transaction on disagreement.
-- Re-running verifies the existing audited correction without updating rows.
BEGIN;
CREATE TABLE IF NOT EXISTS "StripeInvoiceReconciliationAudit" (
  "reconciliationKey" TEXT PRIMARY KEY,
  "invoiceId" TEXT NOT NULL,
  "jobNumber" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "beforeSnapshot" JSONB NOT NULL,
  "afterSnapshot" JSONB NOT NULL,
  "stripeEvidence" JSONB NOT NULL,
  "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "StripeInvoiceReconciliationAudit_invoiceId_idx"
  ON "StripeInvoiceReconciliationAudit" ("invoiceId");
ALTER TABLE "StripeInvoiceReconciliationAudit" ENABLE ROW LEVEL SECURITY;

DO $repair$
DECLARE
  repair RECORD;
  saved "Invoice"%ROWTYPE;
  before_row JSONB;
  after_row JSONB;
  expected_after JSONB;
  audit_key TEXT;
BEGIN
  FOR repair IN SELECT * FROM (VALUES
    ('1e3045da-2363-44c7-a4cd-a0043a50de90', '92578acf-d375-4eb4-acf1-0d62ca4c4f62', '000026', '{"grandTotal": 988, "taxAmount": 0, "subtotal": 950, "laborTotal": 950, "cardSurchargeAmount": 38}'::jsonb, '{"grandTotal": 987.17, "taxAmount": 113.57, "subtotal": 840.0, "laborTotal": 840.0, "cardSurchargeAmount": 33.6, "stripeSessionId": "cs_live_b1MjVXb3U6L0u4BGJ5XguBUcmMT87r8d7i81DxBQQivEOAlO50RYtEHOen", "stripeSessionStatus": "complete", "stripeChargeId": "ch_3UIs3e4FaSxN8UNo0FAzor94", "stripeSessionExpiresAt": "2026-09-24T15:11:12.000Z", "stripePaymentLinkExpiresAt": "2026-09-24T15:11:12.000Z"}'::jsonb, '{"verified": {"stripeInvoiceId": "in_1UIs3h4FaSxN8UNorvDmIYkQ", "stripeSessionId": "cs_live_b1MjVXb3U6L0u4BGJ5XguBUcmMT87r8d7i81DxBQQivEOAlO50RYtEHOen", "stripeSessionStatus": "complete", "sessionExpiresAt": "2026-09-24T15:11:12.000Z", "stripePaymentIntentId": "pi_3UIs3e4FaSxN8UNo0BvHseY1", "stripeChargeId": "ch_3UIs3e4FaSxN8UNo0FAzor94", "invoicePaymentId": "inpay_1UIs3h4FaSxN8UNo7BpnkbDQ", "currency": "cad", "status": "paid", "amountPaidCents": 98717, "taxAmountCents": 11357, "serviceCents": 84000, "feeCents": 3360, "chargeAmountCents": 98717, "refundedCents": 0}, "expiredEvent": {"id": "evt_1UJEMM4FaSxN8UNoGoANYfIX", "type": "checkout.session.expired", "created": 1790262894, "sessionId": "cs_live_b1G49UuCODs3xghfxX7lf2vGZEDuyBKlTHb59NjRIZcYGXXBfUePFfW9UD", "amountTotalCents": 98800, "taxCents": 0, "paymentStatus": "unpaid"}}'::jsonb),
    ('7fb2dcc0-bb21-4321-ad77-c70fb5e6f93f', '51806338-bee5-4a47-9fb7-18d5e7b5d86a', '000038', '{"grandTotal": 624, "taxAmount": 0, "subtotal": 850, "laborTotal": 850, "cardSurchargeAmount": 34}'::jsonb, '{"grandTotal": 998.92, "taxAmount": 114.92, "subtotal": 850.0, "laborTotal": 850.0, "cardSurchargeAmount": 34.0, "stripeSessionId": "cs_live_b1UvzvEl4OjdM1wWKWPZW77FKGc7u9p3yYkzlY4dVWoFlUcON2OBd0LLR9", "stripeSessionStatus": "complete", "stripeChargeId": "ch_3ULona4FaSxN8UNo0fEn3yPH", "stripeSessionExpiresAt": "2026-10-02T18:27:14.000Z", "stripePaymentLinkExpiresAt": "2026-10-02T18:27:14.000Z"}'::jsonb, '{"verified": {"stripeInvoiceId": "in_1ULonc4FaSxN8UNoRn4xbsLA", "stripeSessionId": "cs_live_b1UvzvEl4OjdM1wWKWPZW77FKGc7u9p3yYkzlY4dVWoFlUcON2OBd0LLR9", "stripeSessionStatus": "complete", "sessionExpiresAt": "2026-10-02T18:27:14.000Z", "stripePaymentIntentId": "pi_3ULona4FaSxN8UNo07HE01Fz", "stripeChargeId": "ch_3ULona4FaSxN8UNo0fEn3yPH", "invoicePaymentId": "inpay_1ULonc4FaSxN8UNoSBBsjEaB", "currency": "cad", "status": "paid", "amountPaidCents": 99892, "taxAmountCents": 11492, "serviceCents": 85000, "feeCents": 3400, "chargeAmountCents": 99892, "refundedCents": 0}, "expiredEvent": {"id": "evt_1UMAjW4FaSxN8UNoNLaQXmEB", "type": "checkout.session.expired", "created": 1790963938, "sessionId": "cs_live_b1zFBBGlCqWh4fwF5nhSpe0o7Vf8mAvwCsz9NXGlUzRDkExb4K6uhU0u1W", "amountTotalCents": 62400, "taxCents": 0, "paymentStatus": "unpaid"}}'::jsonb)
  ) AS repairs(invoice_id, job_id, job_number, expected_before, desired, evidence)
  LOOP
    SELECT * INTO STRICT saved FROM "Invoice" WHERE id=repair.invoice_id FOR UPDATE;
    before_row := to_jsonb(saved);
    audit_key := 'stripe-paid-reconciliation-2026-10-03-' || repair.job_number;
    IF saved."jobId" <> repair.job_id
      OR NOT EXISTS (SELECT 1 FROM "Job" WHERE id=repair.job_id AND "jobNumber"=repair.job_number)
      OR saved."paymentStatus" <> 'PAID' OR saved."paymentMethod" IS DISTINCT FROM 'CREDIT_CARD'
      OR saved."paymentProvider" IS DISTINCT FROM 'STRIPE' OR NOT saved."taxCollected"
      OR saved."stripeInvoiceId" IS DISTINCT FROM repair.evidence->'verified'->>'stripeInvoiceId'
      OR saved."stripePaymentIntentId" IS DISTINCT FROM repair.evidence->'verified'->>'stripePaymentIntentId'
      OR round(saved."totalAmountCollected"::numeric*100) <> (repair.evidence->'verified'->>'amountPaidCents')::numeric
      OR saved."partsTotal" <> 0 OR saved."cardSurchargeRate" <> 0.04
      OR saved."taxRate" <> 0.13 OR saved."pricingModel" IS NOT NULL
      OR (saved."stripeChargeId" IS NOT NULL AND saved."stripeChargeId" <> repair.desired->>'stripeChargeId') THEN
      RAISE EXCEPTION 'Stripe reconciliation guard failed for job %', repair.job_number;
    END IF;
    expected_after := repair.desired || jsonb_build_object(
      'stripeSessionExpiresAt', ((repair.desired->>'stripeSessionExpiresAt')::timestamptz AT TIME ZONE 'UTC'),
      'stripePaymentLinkExpiresAt', ((repair.desired->>'stripePaymentLinkExpiresAt')::timestamptz AT TIME ZONE 'UTC'));
    IF EXISTS (SELECT 1 FROM "StripeInvoiceReconciliationAudit" WHERE "reconciliationKey"=audit_key) THEN
      IF NOT (before_row @> expected_after) THEN
        RAISE EXCEPTION 'Audited correction has drifted for job %', repair.job_number;
      END IF;
      CONTINUE;
    END IF;
    IF NOT (before_row @> repair.expected_before) OR saved."stripeSessionStatus" <> 'expired'
      OR saved."stripeSessionId" IS DISTINCT FROM repair.evidence->'expiredEvent'->>'sessionId' THEN
      RAISE EXCEPTION 'Unexpected original financial state for job %', repair.job_number;
    END IF;
    UPDATE "Invoice" SET
      "grandTotal"=(repair.desired->>'grandTotal')::double precision,
      "taxAmount"=(repair.desired->>'taxAmount')::double precision,
      "subtotal"=(repair.desired->>'subtotal')::double precision,
      "laborTotal"=(repair.desired->>'laborTotal')::double precision,
      "cardSurchargeAmount"=(repair.desired->>'cardSurchargeAmount')::double precision,
      "stripeSessionId"=repair.desired->>'stripeSessionId',
      "stripeSessionStatus"=repair.desired->>'stripeSessionStatus',
      "stripeChargeId"=repair.desired->>'stripeChargeId',
      "stripeSessionExpiresAt"=(repair.desired->>'stripeSessionExpiresAt')::timestamptz AT TIME ZONE 'UTC',
      "stripePaymentLinkExpiresAt"=(repair.desired->>'stripePaymentLinkExpiresAt')::timestamptz AT TIME ZONE 'UTC'
    WHERE id=repair.invoice_id RETURNING to_jsonb("Invoice".*) INTO after_row;
    IF NOT (after_row @> expected_after)
      OR round(((after_row->>'subtotal')::numeric+(after_row->>'cardSurchargeAmount')::numeric+(after_row->>'taxAmount')::numeric)*100)
        <> (repair.evidence->'verified'->>'amountPaidCents')::numeric THEN
      RAISE EXCEPTION 'Corrected invoice components do not balance for job %', repair.job_number;
    END IF;
    INSERT INTO "StripeInvoiceReconciliationAudit"
      ("reconciliationKey","invoiceId","jobNumber","reason","beforeSnapshot","afterSnapshot","stripeEvidence")
    VALUES (audit_key,repair.invoice_id,repair.job_number,
      'Restore verified paid Stripe invoice and HST after unpaid Checkout expiry overwrote accounting fields.',
      before_row,after_row,repair.evidence);
  END LOOP;
END
$repair$;
COMMIT;

SELECT j."jobNumber",i."grandTotal",i."taxAmount",i."totalAmountCollected",i."subtotal",i."cardSurchargeAmount",a."reconciledAt"
FROM "Invoice" i JOIN "Job" j ON j.id=i."jobId"
JOIN "StripeInvoiceReconciliationAudit" a ON a."invoiceId"=i.id
WHERE a."reconciliationKey" IN ('stripe-paid-reconciliation-2026-10-03-000026','stripe-paid-reconciliation-2026-10-03-000038')
ORDER BY j."jobNumber";
