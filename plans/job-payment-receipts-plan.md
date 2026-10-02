# Job pricing and payment receipts: implementation plan

## Goal

Update the Locksmith Operations portal so a customer is shown and accepts both available prices before a job is approved: the card price, and a lower non-card price that represents an explicitly disclosed payment-method discount. For example, on a $100 non-card price with a 4% card-price difference, quote **$104 by card** or **$100 by an eligible non-card method**. Do not present the difference as a separate “Admin Fee” or “Card Charge” line, and do not change an already accepted $100 quote to $104 after the fact.

Once paid, let Admins and Dispatchers retrieve the correct customer document for completed, on-books jobs: the portal's immutable PDF receipt for supported non-card payments, and Stripe's genuine receipt plus paid invoice PDF for verified Stripe payments. Both document paths must show Locksmith's correct issuer identity and tax information and reflect the price actually accepted and paid.

This plan includes price quote persistence, manual job creation/editing, Stripe checkout, webhook reconciliation, local receipt generation, Dispatch UI, refund/correction history, testing, and release configuration. It does not rewrite already issued documents or turn job receipts into Books partner invoices.

## Implementation status

The portal code, additive migrations, Admin/Dispatcher receipt UI, Stripe document links, dual-price quote capture, stale-session protection, local receipt PDF generation, and Admin void/history controls are implemented. Historical Stripe documents are retrieved as originally issued and remain independent of today's tax profile; new dual-price Stripe document requests verify the live issuer name, address, and HST ID. Review regression coverage now includes API-level 4% cap checks, the receipt eligibility matrix, Toronto HST effective-date boundaries, local receipt PDF issuance/idempotency, and historical Stripe document retrieval. Type checking, Prisma validation, focused tests, whitespace checks, and the production build pass. Keep `LOCKSMITH_DUAL_PRICING_APPROVED` disabled until the processor/accountant review and Stripe document inspection are complete. Production migrations have not been applied by this code change.

## Phase 0 — confirmed decisions, discovery, and release questions

### Confirmed by the business

- The $100 / $104 example means a **$100 non-card price and $104 card price**, disclosed together before job approval. The $4 difference is represented by the two prices; it is not an extra admin or card-fee line added to a $100 accepted invoice.
- The difference is intended to recover payment processing expense; the business does not intend to absorb that expense. Store the price choice and disclosure/acceptance evidence so the final receipt is based on the agreed price.
- The Locksmith issuer identity is `Better Call Locksmith Inc.`, corporation number `1001348245`, address `222 Spadina Avenue, Unit 114, Toronto, Ontario M5T 3B3, Canada`, HST registration `70229 1725 RT0001` (normalized for storage as `702291725RT0001`), effective January 1, 2026. Current source defaults are in `src/lib/accounting-types.ts` and `prisma/seed.js`.
- Stripe customer documents must come from Stripe. Admins and Dispatchers need portal actions to open/save the hosted Stripe receipt and download Stripe's paid invoice PDF where available.
- Local on-books receipt issuance is restricted to completed, paid jobs with verified payment data and a valid Locksmith issuer. A manually marked card payment without Stripe evidence does not become a Stripe receipt.

### External guidance to follow and verify

- FCAC says merchants may provide discounts by payment method. Its separate surcharge guidance says credit-card surcharges must not exceed actual acceptance cost, have a 2.4% cap, must not be combined with a service/convenience fee, and must be disclosed before payment. See [FCAC merchant pricing guidance](https://www.canada.ca/en/financial-consumer-agency/services/merchants/credit-fees-merchant.html).
- CRA defines a credit-card surcharge by its purpose and whether it is charged only for using a credit card; a label alone does not decide the classification. See [CRA GI-200](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/gi-200/application-gst-hst-credit-card-surcharges.html).
- Stripe currently publishes Canadian domestic online card pricing as 2.9% + CA$0.30, and Stripe Invoicing adds 0.4% on standard pricing. Locksmith's actual Stripe balance transactions and contract are the source of truth for its cost. See [Stripe Canada pricing](https://stripe.com/en-ca/pricing). Do not infer the right customer price or expense from a generic fee estimate.
- Use Stripe's official [Checkout Session API](https://docs.stripe.com/api/checkout/sessions/object), [PaymentIntent API](https://docs.stripe.com/api/payment_intents/object), [Charge API](https://docs.stripe.com/api/charges/object), [Invoice API](https://docs.stripe.com/api/invoices/object), and [GST/HST tax ID docs](https://docs.stripe.com/tax/invoicing/tax-ids) to verify document and payment fields. `Charge.receipt_url` is a hosted receipt; `Invoice.invoice_pdf` is an invoice PDF. Do not invent a Stripe receipt-PDF API.
- For local tax receipt requirements, consult CRA's [GST/HST rate and charge/collect guidance](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html) and [documentary requirements for input tax credits](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/8-4/documentary-requirements-claiming-input-tax-credits.html).
- Before production release, have the payment processor confirm the proposed card-price/non-card-discount presentation and eligible non-card methods, and have the accountant confirm the HST basis and representation of the discount. This plan records a pricing model, not a legal or tax opinion.

### Repository contracts discovered

- `CLAUDE.md`: production schema changes use an additive hand-written SQL migration and a documented deployment step; local SQLite is not production. `npm run build` is the main correctness gate; individual scripts under `tests/` run with Node's type stripping. No repository-wide test command is defined.
- `prisma/schema.prisma:249-316`: `Invoice` currently stores active financial values (`subtotal`, HST, `cardSurchargeRate`, `cardSurchargeAmount`, `grandTotal`, `totalAmountCollected`, tax flag, provider IDs, `paidAt`). `JobPaymentReceipt` already stores a unique receipt number/revision, immutable JSON snapshot, PDF bytes, issuer metadata, void data, and replacement relation.
- `src/lib/calculations.ts`: financial calculations are shared. Pending manual card jobs use `calculateDualPriceManualCardQuote`; the 4% difference produces two disclosed service prices and no fee line. Other forward/closeout helpers retain their separate legacy card-surcharge calculations.
- `src/app/dispatch/page.tsx`: Admin/Dispatcher manual-job form, initial payment method/status, 4% maximum price-difference input, live card/non-card tax estimates, and customer acceptance recording; it submits to `POST /api/jobs/manual`.
- `src/app/api/jobs/manual/route.ts:74-123,138-183`: server validation and manual job/invoice creation. `src/app/api/jobs/manual/[id]/route.ts:150-280` handles edits, protects issued receipts/settled Stripe invoices, and must use the same pricing rules.
- `src/app/api/jobs/[id]/payment-link/route.ts:38-144`: validates a pending card invoice and passes its stored totals to `createStripePaymentLink`.
- `src/lib/stripe.ts`: Stripe REST helper creates Checkout sessions and Stripe invoices. `DUAL_PRICE_V1` sends the accepted card price as one service line and leaves tax calculation to Stripe; legacy fee paths retain their historical itemization.
- `src/app/api/webhooks/stripe/route.ts:96-251`: verifies and deduplicates Stripe events; webhook-saved payment/tax totals are authoritative.
- `src/lib/manual-job.ts`: normalizes legacy manual invoice data and exempts pending dual-price/Stripe invoices from legacy tax-inclusive recalculation.
- Receipt code already exists in this working tree: `src/lib/job-receipt.ts` (including PDF building), `src/app/api/jobs/[id]/receipt/route.ts`, `src/app/api/jobs/[id]/receipt/stripe/route.ts`, and void/history routes. `getJobReceiptState(job)` is the shared eligibility function; `createOrLoadJobPaymentReceipt(job, issuedById)` makes a locked immutable local receipt snapshot. The Receipt UI exists in Dispatch list/board/detail. Preserve these properties while updating price presentation.
- `src/lib/accounting-invoice-pdf.ts` and `src/app/api/books/expenses/[id]/receipt/route.ts` are PDF and private-response examples. They are not the source of job receipts.
- App SMS integrations create drafts only; they do not send messages. If a written quote is needed, use an existing draft/share capability and persist the acceptance record. Never claim the portal delivered a quote by SMS.

### Allowed APIs and implementation patterns

- Use the pure functions in `src/lib/calculations.ts` (or new pure pricing helpers in that module) as the only price/tax calculation authority. Server endpoints recalculate from validated inputs and ignore client-supplied totals.
- Use `prisma.$transaction` and database constraints/row locks following receipt issuance patterns for quote acceptance and idempotent issuance. Keep Stripe network requests outside database transactions.
- Use `createStripePaymentLink` and its existing Stripe REST helpers; preserve its idempotency, request timeout/error pattern, metadata, and session reuse contract. Do not introduce a second payment API or rely on browser redirects for paid status.
- Continue using webhook-confirmed Stripe invoice totals, tax, payment intent, charge, and refund status as the provider truth.
- Continue using `getCurrentUser`, Admin/Dispatcher server-side checks, and private/no-store document responses. Hiding a button is not authorization.
- Continue using the `LOCKSMITH` AccountingEntity as the single local issuer source. The receipt API must not use the IT Marketing entity, `CRA_HST_BUSINESS_NUMBER`, or a hard-coded number in email code.

### Decisions to resolve before implementation

1. **What the 4% is measured against:** recommended: for a disclosed $100 non-card service subtotal, card price subtotal is `$100 × 1.04 = $104`; calculate HST on the accepted taxable consideration using accountant-approved rules. Persist actual quoted amounts in cents so the receipt never recomputes them from a rate. Decide whether the 4% is a business-wide default, a per-job override, or both with permission limits.
2. **Which options qualify for the discount:** explicitly list accepted non-card methods. Confirm whether portal `INTERAC` means e-transfer/cash-like payment or an Interac debit transaction; card-network treatment can differ. Stripe Checkout currently accepts card and can include debit, so do not claim the Stripe path is credit-card-only.
3. **Acceptance evidence:** require the dispatcher to record that the customer saw both prices, which option they accepted, when, and how acceptance was obtained (for example, phone/verbal or written). Existing SMS is draft-only. Do not issue a higher Stripe charge when only the lower price was recorded as accepted.
4. **Existing pending card links:** choose to expire/revoke or clearly supersede any open link whose old separate-fee amount differs from the new approved quote; do not silently reuse it. Completed/paid legacy transactions retain their historical amount, label, and source document.
5. **Other Stripe entry paths:** decide whether the new price-choice model applies only to manual Dispatch-created Stripe payment links or also normal invoice closeout, travel-fee checkout, payment retries, and other Stripe entry points. Inventory and tests must find all of them; no path may add the old fee while another uses dual prices. A safe initial release may gate the new model to the manual quote path and block other card-price paths until included.
6. **Stripe document issuer release gate:** verify the live/test Stripe account ID, public Locksmith name/address, and default `ca_gst_hst` tax ID. Keep `LOCKSMITH_STRIPE_DOCUMENT_ISSUER_VERIFIED` false until a test payment proves Stripe's receipt and invoice show the correct Locksmith identity and tax information.

## Eligibility and receipt source matrix

| Job/invoice condition | Portal behavior | Document source |
| --- | --- | --- |
| `COMPLETED`, `PAID`, explicitly on-books, eligible non-card payment, valid HST period and Locksmith identity | Admin/Dispatcher can issue/download immutable PDF receipt | Portal PDF snapshot |
| `COMPLETED`, `PAID`, `paymentProvider='STRIPE'`, validated Stripe invoice/charge and matching accepted card price | Admin/Dispatcher can view/save Stripe receipt and download paid invoice PDF when present | Fresh Stripe API lookup and Stripe-hosted documents |
| Pending payment, even when job status is `COMPLETED` | Show pending; no receipt | None |
| Off-books (`taxCollected !== true`) | Show off-books; no official tax receipt | None |
| Card method recorded manually without Stripe provider evidence | Explain provider evidence is missing; no manufactured Stripe receipt | None |
| Fully refunded, cancelled, abandoned-fee, missing issuer, mismatched account/amount/tax | Block or show a precise unavailable state | None |
| Partially refunded Stripe payment | Show original paid document plus distinct partial-refund state; determine whether a refund document is linked | Stripe source, subject to supported refund records |
| Legacy paid rows before new dual-price deployment | Receipt uses verified historical amount and issuer eligibility; do not infer or backfill a discount | Existing source or no receipt if unsupported |

Use `getJobReceiptState(job)` and recheck eligibility in every download/issue endpoint. Require `taxCollected === true`, `paidAt`, valid totals, completed status, correct payment provider, and issuer identity/effective date; do not infer any of these from `COMPLETED` or a checkout URL.

## Phase 1 — data inventory and price/issuer domain model

### Implement

1. Run a read-only inventory of completed/paid invoices: payment method/provider, old surcharge fields, `taxCollected`, `paidAt`, HST/totals, Stripe IDs, open Checkout Sessions, and receipt state. Report counts and representative anonymized records. Do not modify historical data during inventory.
2. Define an explicit quote/pricing snapshot. Recommended: a versioned immutable quote record or equivalent invoice fields containing (a) non-card subtotal and total, (b) card subtotal and total, (c) configured rate used, (d) HST calculation basis/rate/amount for each option where determinable, (e) which price option customer accepted, (f) accepted final amount, (g) disclosure/acceptance timestamp and actor/method, and (h) quote revision. Define money fields as integer cents or Prisma Decimal with explicit conversion helpers.
3. Preserve `Invoice.cardSurchargeRate` and `cardSurchargeAmount` as legacy facts. Add an explicit `pricingModel`/version (`LEGACY_FEE`, `DUAL_PRICE`, `STANDARD`) or quote relation so new data cannot be mistaken for old data. Never relabel historical surcharge rows as discounts.
4. For local receipt issuance, keep `JobPaymentReceipt` as the immutable issued document record. Store a snapshot of the accepted quote, selected option, paid invoice amounts, issuer snapshot, and Stripe references (or local payment metadata). Receipt revisions/replacements must retain a link to the previous version.
5. Ensure Locksmith issuer configuration is complete and date-effective: legal name `Better Call Locksmith Inc.`, corporation number `1001348245`, address `222 Spadina Avenue, Unit 114, Toronto, Ontario M5T 3B3, Canada`, HST `702291725RT0001`, and HST effective date `2026-01-01`. Do not issue an HST receipt before the registration effective date or when the issuer record is incomplete.
6. Decide exact additive SQL migration(s) and rollback/forward procedure per `DEPLOYMENT.md`; do not use production `prisma db push`. No automatic quote backfill unless historical customer acceptance and amounts are proven by source records.

### Documentation and patterns

- Copy existing receipt immutability and active receipt constraints from `prisma/schema.prisma:249-316` and `prisma/job-payment-receipts-migration.sql`.
- Follow the repository's hand-written SQL migration instructions in `CLAUDE.md` and `DEPLOYMENT.md`.
- Use `AccountingEntity.code='LOCKSMITH'` as in `src/lib/accounting-types.ts:58-75` and seed/update patterns in `prisma/seed.js:46-75`.

### Verify

- Legacy invoices stay `LEGACY_FEE` and retain all original stored amounts/labels.
- New accepted quotes round to cents and both displayed price choices are stored before payment.
- Quote changes create a revision and never mutate a previously accepted revision.
- Issuer validation uses the Locksmith business ID and HST registration as separate fields.
- No guessed tax or pricing history is backfilled.

### Guard against

- Treating the second price as an invoice fee, calling it an admin fee, or attaching it after a lower quote was accepted.
- Trusting client-calculated totals or deriving a discount later from payment method.
- Reusing the IT Marketing issuer/HST number or confusing corporate number with HST registration.
- Silently changing the meaning of existing `cardSurcharge*` values.

## Phase 2 — dual-price calculation, validation, and quote acceptance

### Implement

1. Add pure helpers in `src/lib/calculations.ts` for quote generation. Given a base/non-card service subtotal and configured rate, produce the displayed non-card price and card price, then calculate the tax and total for each option according to the approved tax model. With the example inputs, the pre-tax service choices must be exactly $100 and $104 before HST. Use cents and deterministic rounding; test the reverse conversion and HST edge cases.
2. Separate the selected **price class** (`CARD`/`NON_CARD`) from actual tender (`STRIPE_CARD`, `CASH`, `INTERAC`, etc.). A discount attaches to the accepted price option, not an “admin” line and not a guess based on a payment-method string after the fact.
3. Add server-side quote validation and acceptance capture. Persist the exact two prices disclosed, option selected, accepted final amount, revision, time, actor and acceptance channel/evidence. Reject Stripe link creation unless the accepted option is card and amount matches the persisted card quote. Reject marking a non-card quote paid with an amount inconsistent with the chosen non-card quote unless an authorized price revision is created and re-accepted.
4. Update `POST /api/jobs/manual` and `PATCH /api/jobs/manual/[id]` to validate quote state and derive totals server-side. Keep edit-vs-receipt serialization and settled Stripe protections. A changed financial quote invalidates an unissued payment link and creates a new accepted quote; already paid jobs require an audited correction/refund path.
5. Keep manual on-books cash/Interac records tax-correct and distinguish “price accepted” from “amount collected.” For historic manual jobs, preserve `calculateManualInvoice` behavior unless a new quote snapshot exists.
6. Add tests for `$100 -> $104` pre-tax example, percent interpretation, HST on both options, rounding, zero/negative values, changed quote revision, tampered client totals, stale acceptance, duplicate submissions, and mismatched selected payment class/tender.

### Documentation and patterns

- Use central helpers in `src/lib/calculations.ts:51-180`; supersede `calculatePendingManualCardInvoice` for new quotes instead of scattering arithmetic.
- Follow API validation and database transaction conventions in `src/app/api/jobs/manual/route.ts:74-123,125-183` and `src/app/api/jobs/manual/[id]/route.ts:150-280`.
- Keep `src/lib/manual-job.ts:43-80` legacy normalization isolated from the versioned new pricing data.

### Verify

- Both prices and selected amount are calculated identically in UI and server response; the server remains authoritative.
- A selected card quote does not serialize a fee item or `cardSurchargeAmount` for new data.
- A non-card payment uses the stored accepted discounted price, with correct HST and actual amount collected.
- Old saved invoices keep their previous interpretation.

### Guard against

- Reusing `cardSurchargeAmount` to store the price difference on new rows.
- Showing the regular/non-card price alone and revealing the card total at checkout.
- Accepting a selected price based solely on the payment method chosen after the service was completed.

## Phase 3 — Dispatch quote UI and customer disclosure

### Implement

1. In **Add Job**, when Payment status is **Pending** and payment mode is **Credit Card** (and any other supported card mode), replace the `Card processing fee (%)` field with a `Card-price difference (%)` field. The default 4% means a $100 non-card price and a $104 card price before tax. Show both named prices, the estimated Ontario HST on each, and each tax-inclusive total immediately in the form. State that this is the quoted card price difference, not a separate card surcharge, processing-fee, or admin-fee line. The displayed totals are estimates until Stripe resolves the customer's billing location; Stripe Checkout must show the final amount and tax before card authorization.
2. The pending-card condition must also show an explicit customer-acceptance checkbox, verbal/written acceptance selector, and required acceptance note. Changing the non-card price, price-difference percentage, payment method, or payment status clears the checkbox and note. The server records `DUAL_PRICE_V1`, both computed prices, the accepted `CARD` option, acceptance method, timestamp, dispatcher ID, and evidence note. No payment link is generated without that persisted acceptance record. Other payment modes/statuses do not show card quote fields.
3. Provide a copyable/shareable quote summary for existing SMS draft workflows, and state that the portal does not send it. A customer-facing price must include the actual total/HST disclosure needed for acceptance before work/payment. Do not rely on a receipt created after payment as the first disclosure.
4. Update UI schema validation and form state (`validateManualJobForm` near `src/app/dispatch/page.tsx:28-73`, defaults near `:253-272`, submission near `:638-648`). Update completed-job edit forms and detail views to show immutable accepted prices and new revisions clearly.
5. Ensure accessibility: keyboard selection, mobile layout, visible tax breakdown, clear choice labels, and no ambiguity between job subtotal and total due. A completed job's **Receipt** action opens a dedicated preview/chooser. The preview has an explicit **Download receipt as PDF** action for eligible on-books Cash/Interac jobs; for Stripe it clearly identifies Stripe as the source and offers **View Stripe receipt** and **Download Stripe invoice PDF**. Ineligible completed jobs open the same page with a reason and no document action.

### Verify

- With Pending + Credit Card, the form shows both pre-tax price options, Ontario HST estimates, and tax-inclusive totals; acceptance checkbox and note are mandatory. Changing the quote clears prior acceptance.
- Card link and non-card payment flows show only the accepted price.
- If customer acceptance is missing or the chosen option conflicts with tender, API blocks it with actionable message.
- No customer-facing quote or Stripe Checkout invoice line says the price difference is a surcharge/admin fee. Stripe's new invoice contains only the accepted card service price plus Stripe-calculated tax.
- The dual-price payment-link API stays disabled until `LOCKSMITH_DUAL_PRICING_APPROVED=true` is set after processor and accountant review; this flag is a release gate, not a claim of legal approval.

### Guard against

- UI-only price checks, undocumented “verbal consent” defaults, or calling a generated draft a sent message.
- Retroactive repricing of a job already completed under an accepted quote.

## Phase 4 — Stripe Checkout, invoice generation, and payment reconciliation

### Implement

1. Update `CreatePaymentLinkParams`, `/api/jobs/[id]/payment-link`, and `createStripePaymentLink` so Checkout charges the **accepted card price** as the service amount. Its generated invoice should show a service price matching the card quote; it must not add a separate card-processing/admin-fee product for the new pricing model. Preserve invoice/job/customer metadata, request revision fingerprinting, idempotency, customer info, and automatic tax behavior.
2. Keep any alternative non-card discounted price in the portal quote snapshot and customer-facing pre-acceptance quote. Decide with accounting whether Stripe should show a note that a non-card discount was available, or simply the accepted card price; do not apply a Stripe discount to a customer who selected the card amount.
3. On `checkout.session.completed`/verified success webhook, reconcile session, payment intent, charge, invoice metadata, currency, amount, HST, customer, quote revision and selected option. Persist Stripe's actual `amount_total`, `amount_tax`, paid timestamp, and IDs. Ensure exact amount matches the accepted card quote plus calculated HST, within defined cent rounding.
4. Ensure new Stripe invoice and receipt issuer details match the `LOCKSMITH` entity. The configured account must be bound to a verified Stripe account ID. Resolve effective HST registration as of transaction/payment tax date; fail closed where needed.
5. Handle expired or open legacy payment links during migration: expire an open Stripe session before changing its quote; serialize webhook settlement with quote edits and require that paid Checkout Session/Invoice IDs still match the saved quote. Treat completion of a stale session as a reconciliation error rather than attaching it to the edited job. Existing legacy pending rows without quote acceptance must be re-quoted before a new payment link is created.
6. Include refund states and events already supported. A full refund removes receipt eligibility; a partial refund remains visible and clearly labelled, with Stripe as source for the underlying payment documents.

### Documentation and patterns

- Copy REST/idempotency behavior from `src/lib/stripe.ts:78-94,138-173,227-310`.
- Follow payment-link validation/session reuse from `src/app/api/jobs/[id]/payment-link/route.ts:38-144`.
- Follow webhook verification/dedupe/transaction behavior from `src/app/api/webhooks/stripe/route.ts:96-251`; provider requests stay outside short DB transactions.
- Consult the exact Stripe API documents listed in Phase 0 (Checkout Session, PaymentIntent, Charge, Invoice, account tax IDs) before selecting API fields. Keep `receipt_url` distinct from downloadable invoice PDF.

### Verify

- Test mode Stripe invoice has one correctly priced service line, proper Locksmith seller/HST, and correct tax calculation; no new card/admin fee line appears.
- Webhook payment total/tax exactly reconcile to accepted quote and saved invoice values; forged/stale/wrong-job metadata is rejected.
- Payment link stale revision and retries are safe and idempotent.
- Test refunds, webhook replay, unmatched refund events, and amount mismatches.

### Guard against

- Treating Checkout success redirect as proof of payment.
- Double-counting tax, adding HST to an amount Stripe already tax-calculated, or itemizing the old fee on a new dual-price invoice.
- Reusing a link for an obsolete quote or changing finalized Stripe documents in place.

## Phase 5 — immutable local receipt and Stripe-document endpoints

### Implement

1. Keep `getJobReceiptState(job)` as the shared state model. For local receipts, require `COMPLETED`, `PAID`, explicit on-books status, supported non-card tender, authoritative `paidAt`, valid HST/effective date, and a valid Locksmith issuer. For Stripe documents, require matching provider/payment IDs, paid status and tax/amount data from Stripe.
2. Extend the immutable receipt snapshot with the accepted quote revision, price choice, non-card discount if applied, actually paid subtotal/tax/total, payment method, paid timestamp, issuer snapshot, and source payment references. Preserve existing receipt number/revision/void/replacement behavior.
3. For the local PDF, show “Payment Receipt,” unique receipt number, Locksmith legal name, corporation number, full verified address, HST registration, customer and job details, actual price paid, any applicable accepted non-card discount (if needed to explain the accepted total), HST rate/amount, total, payment method, and paid date/time in Toronto timezone. Use itemized job/parts lines only when they reconcile to financial totals; otherwise show a generic reconciled service line. Never show internal COGS, commissions, settlement values, signatures, or secrets.
4. Keep separate Admin/Dispatcher routes for local receipt PDF, Stripe hosted receipt, Stripe paid invoice PDF, Admin void, and Admin receipt history. Revalidate role/eligibility at download. Stripe endpoints redirect only to allowlisted HTTPS Stripe hosts and fetch fresh document URLs; local PDFs use private/no-store attachment headers.
5. Freeze financial edits once a local receipt is issued until an Admin voids with a reason and a numbered replacement can be generated. Preserve old bytes/snapshot. Protect paid Stripe financial data from manual edits; correct it through refund/reconciliation and a new invoice/quote.
6. No document is issued for pending, off-books, fully refunded, cancelled, abandoned, incomplete issuer, missing HST registration, incorrect account, or manual card without verified Stripe evidence.

### Documentation and patterns

- Use `src/lib/job-receipt.ts` transaction, eligibility, snapshot and PDF persistence patterns; review `src/app/api/jobs/[id]/receipt/*` endpoint role/status/headers.
- Copy `pdf-lib` layout primitives from `src/lib/accounting-invoice-pdf.ts` only; keep job customer documents outside Books receipt storage.
- Use `src/lib/timezone.ts` functions for Toronto-local display instead of server-local date conversion.
- Validate HST itemization against CRA sources in Phase 0. Confirm if the non-card discount changes taxable consideration before encoding receipt math.

### Verify

- Downloaded local receipt exactly matches the accepted non-card quote and actual paid transaction and includes correct Locksmith identity/HST.
- Stripe receipt and invoice PDF are genuine, paid, correctly linked to job/invoice/accepted quote, have verified Locksmith identity/HST, and are not cached/stored as a public URL.
- Parallel first downloads issue one stable receipt number; local receipt corrections preserve original and generate linked replacement.
- Direct endpoint calls for ineligible jobs/unauthorized roles cannot return documents.

### Guard against

- Using mutable live job data as sole source for already issued PDFs.
- Fabricating a Stripe receipt or claiming Stripe's hosted `receipt_url` is a PDF.
- Exposing receipt data to a public storage bucket or allowing arbitrary user redirect destinations.

## Phase 6 — Dispatch access and operational states

### Implement

1. Return server-calculated receipt availability in `/api/jobs` and job detail using existing `getJobReceiptState(job)`; never return a raw Stripe hosted URL in list JSON.
2. Maintain receipt actions in Dispatch completed-job table, board and detail (`src/app/dispatch/page.tsx`, `src/app/dispatch/jobs/[id]/page.tsx`). Admin and Dispatcher can access; all endpoints authorize independently.
3. Label local documents “Download payment receipt (PDF).” Label Stripe documents “View/save Stripe receipt” and “Download Stripe invoice (PDF).” Do not call the Stripe invoice a receipt.
4. Show usable status reasons: payment pending, off-books, Stripe payment not linked, fully refunded, partial refund, issuer configuration incomplete, or document temporarily unavailable. Ensure new quote price option and selected total can be seen by authorized dispatchers without exposing private document data.
5. Refresh states after webhook updates, manual edits, refunds, or a receipt void/reissue.

### Verify

- Admin and Dispatcher can find/use actions from list, board, and detail on desktop/mobile.
- Pending/off-books/refunded/manual-card-without-Stripe rows have no live receipt button and show accurate status.
- 401/403 and direct-route tests prove UI visibility is not the only gate.

### Guard against

- Inferring receipt readiness from a payment method or `COMPLETED` status alone.
- Hiding a compliance or issuer failure behind a generic “download failed” message.

## Phase 7 — verification, rollout, and acceptance

### Tests and release checks

1. Add focused Node assertion scripts consistent with `tests/calculations.test.ts`, `tests/stripe.test.ts`, and `tests/e2e.test.ts` for quote calculations, HST, rounding, accepted-price recording, API tampering, quote revisions, and old-invoice compatibility.
2. Test receipt eligibility matrix, role checks, issuance concurrency, PDF bytes/content, void/history replacement, Stripe URL/account/identity/amount validation, webhook retries, partial/full refund behavior, issuer effective date, and unmatched provider records.
3. Run focused scripts with `node --experimental-strip-types tests/<file>.test.ts`, `npx prisma generate`, `npx tsc --noEmit`, `git diff --check`, and `npm run build`. The full build and tests require an appropriately configured development DB where relevant.
4. Apply additive production SQL migrations in documented order. Confirm current database schema and HST record first; back up/verify before migration. Do not use destructive reset or production `db push`.
5. In Stripe test mode, create a fresh quote, record customer acceptance of card option, complete Checkout, receive verified webhook, and inspect both customer documents. Separately test accepted non-card discount paid on books and inspect the portal PDF. Verify the issued local and Stripe docs use the correct issuer name, corporation number, address, HST registration, tax basis/amount, price choice and amount.
6. Keep Stripe issuer verification gated until actual test receipt/PDF confirmation is complete. Document production configuration keys and support steps for payment mismatches, stale links, missing references, tax/issuer configuration, Stripe outage, refund, and receipt correction in `DEPLOYMENT.md`.

### Release acceptance criteria

- A customer sees the card and non-card price and relevant tax-inclusive total before approving the quote. The accepted option and evidence are stored. Example: $100 non-card/$104 card before HST at a 4% price difference.
- No new invoice adds a separate card/admin fee line for a Stripe-only cost. New Stripe checkout charges the accepted card price as the service price. Existing legacy fee rows/documents remain unchanged and identifiable as legacy.
- A non-card customer is charged the accepted discounted amount and receipt mirrors the actual payment and accountant-approved HST treatment.
- Admin and Dispatcher can retrieve local receipts for eligible completed/paid/on-books non-card jobs paid on or after 2026-01-01, and can retrieve Stripe's original documents for verified paid Stripe jobs, including older payments. Existing Stripe documents are linked from Stripe without rewriting their historical tax/fee presentation.
- Every newly issued receipt/invoice identifies `Better Call Locksmith Inc.` (corporation number `1001348245`) and verified Locksmith HST number `702291725RT0001` (effective 2026-01-01) where legally applicable; issuer mismatch blocks release.
- No new local receipt can be issued for unpaid, off-books, fully refunded, cancelled, abandoned, unverified-card, pre-effective-date, unauthorized, or mismatched-Stripe-account records. Previously issued Stripe documents keep Stripe's original availability and document content.
- Historical receipt snapshots are immutable; corrected local receipts are voided and replaced with an auditable revision; settled Stripe documents are corrected through provider refund/reconciliation rather than local rewriting.
- Focused tests, static checks, build, Stripe test payment, and manual PDF inspection all pass before production enablement.
