# Stripe revenue and HST reconciliation — October 3, 2026

## Verified result

All 46 PAID operational invoices now have matching `grandTotal` and `totalAmountCollected` to the cent. The live All Time admin dashboard was refreshed and shows:

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Gross revenue (including HST) | $18,804.45 | $19,178.54 | +$374.09 |
| Cash revenue | $16,748.22 | $16,748.22 | $0.00 |
| Card revenue | $2,056.23 | $2,430.32 | +$374.09 |
| Interac revenue | $0.00 | $0.00 | $0.00 |
| HST collected | $1,977.88 | $2,206.37 | +$228.49 |
| Hardware COGS | $499.70 | $499.70 | $0.00 |
| Allocated technician commissions | $7,744.70 | $7,744.70 | $0.00 |
| Net company profit shown by portal | $8,582.17 | $8,727.77 | +$145.60 |

The portal's profit calculation is $19,178.54 − $2,206.37 − $499.70 − $7,744.70 = $8,727.77. This is the portal metric before any additional Books expenses or advertising deductions.

## Stripe payment evidence

Read the live Stripe invoices, successful Checkout sessions, PAID InvoicePayment allocations, PaymentIntents, charges, tax rate, and expired-session events. The paid allocation, intent received amount, charge amount, and invoice amount paid agree exactly for all three card jobs. Each charge succeeded in CAD and has zero refunded cents at verification time. The referenced Stripe rate is HST at 13%, exclusive.

| Job | Stored gross before | Stripe service | Stripe historical card fee | Stripe HST | Verified payment | Gross correction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| #000026 | $988.00 | $840.00 | $33.60 | $113.57 | $987.17 | −$0.83 |
| #000038 | $624.00 | $850.00 | $34.00 | $114.92 | $998.92 | +$374.92 |
| #000028 (control) | $444.23 | $378.00 | $15.12 | $51.11 | $444.23 | $0.00 |

HST is copied from Stripe's actual tax amounts, including tax on the historical fee line. No current pricing policy was retroactively applied. Stripe's historical invoices and customer receipts remain their original documents.

Provider identifiers, source event IDs, verification time, and integer-cent evidence are in `stripe-revenue-reconciliation-2026-10-03.json`. No API keys, customer contact information, or token-bearing receipt URLs are included.

## Cause and correction

The old webhook built `grandTotal` and `taxAmount` updates from every matching event, before checking whether the event represented a confirmed payment. Both affected invoices retained a saved expired unpaid Checkout session:

- #000026: expired session total $988.00, tax $0.00, delivered after the successful $987.17 payment.
- #000038: expired session total $624.00, tax $0.00, delivered after the successful $998.92 payment.

Those expiry amounts match the corrupted stored fields exactly, while the collected amounts and paid Stripe invoice/payment intent identifiers remained correct. The new webhook limits monetary updates to confirmed CAD card payments and ignores unpaid lifecycle snapshots once an invoice is paid or refunded. It validates integer cents, full invoice payment, provider identifiers, metadata, and accepted dual-price quote evidence. Invoice status no longer replaces Checkout session status. Current and legacy Stripe invoice tax fields are supported; absent tax is preserved as unknown and explicit zero is accepted as zero.

The guarded SQL repair was applied through Microsoft Edge to production Supabase project `kahkbtrotjvyksiileso`. It was first run inside a transaction ending in ROLLBACK. The successful committed repair is timestamped **2026-10-03 23:18:53.827 UTC** for both rows.

For #000026, the obsolete $950 service/$38 fee fields were also restored to Stripe's $840 service/$33.60 fee. For both jobs, the saved session and charge now reference the verified successful payment. Collected amounts, paid dates, commissions, COGS, quote acceptance fields, operational receipts, and issued Books invoice snapshots were preserved. A database comparison confirmed all invoice fields outside the ten explicitly repaired fields were unchanged.

## Audit trail and verification

`StripeInvoiceReconciliationAudit` retains complete before/after Invoice JSON and Stripe evidence under deterministic keys:

- `stripe-paid-reconciliation-2026-10-03-000026`
- `stripe-paid-reconciliation-2026-10-03-000038`

The audit has no cascading foreign key into Job/Invoice, and row level security is enabled with no public read policy. The transaction locks each invoice, requires the exact expected original state and provider evidence, and checks the repaired invoice components balance to the paid amount. Re-running it successfully verified the same two rows without new updates or audit timestamps.

Final database results: 46 PAID jobs, gross $19,178.54, collected $19,178.54, mismatched paid jobs 0, audit records 2, commissions $7,744.70, COGS $499.70.

Raw stored tax sums to $2,132.97. The dashboard correctly shows $2,206.37 because its existing `normalizeManualJobInvoice` read path extracts tax-inclusive HST for older non-Stripe manual jobs. The $73.40 difference predates this repair and was present before it as well ($1,904.48 raw versus $1,977.88 displayed). An audit query that reads raw Invoice tax fields must apply the same legacy normalization to reproduce the portal's HST total.

Issued Books invoices retain the values snapshotted when issued. This correction changes live operational revenue calculations; it does not rewrite issued accounting documents.

Validation completed:

- 14 webhook regression tests, including late expiry/failure, tax schema versions, malformed amounts, stale provider IDs, refunds, duplicate events, and dual-price acceptance.
- Existing Stripe API/signature tests, Stripe receipt verification tests, financial calculation tests, manual quote tests, manual amount tests, revenue period tests, and calendar activity tests.
- `npm run build` with compilation, lint/type validation, and static generation.
- Separate final review of the webhook, guarded SQL, audit schema, Stripe evidence, and selective Git changes.

Stripe reference: [Webhook event ordering](https://docs.stripe.com/webhooks#event-ordering), [Invoice object and tax fields](https://docs.stripe.com/api/invoices/object), [InvoicePayment records](https://docs.stripe.com/api/invoice-payment).
