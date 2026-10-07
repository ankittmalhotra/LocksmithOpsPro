# Books Portal — Personal-Paid Expenses and Reimbursements Plan

## 1. Product outcome

Let a user record a company expense that was initially paid using a partner's or another person's money, including a personal credit card or cash, then record the business repaying that person from the company's bank account. Keep the expense, amount owed, repayments, receipts, and accountant classification visible together in the correct entity's Books.

The portal must preserve two separate sets of books: `1001744934 ONTARIO INC.` (IT & Marketing) and `Better Call Locksmith Inc.` (corporation number `1001348245`, Locksmith). A personal-paid expense belongs to the entity that incurred it, regardless of which person paid. A repayment is a settlement of the amount owed by that entity; it must not create another expense, reduce operational profit a second time, or flow into the Locksmith-to-IT profit-sharing calculation.

Example: a $300 accounting bill plus $39 HST was paid personally for IT & Marketing. Record one IT expense for $300 + $39 and mark it “Paid personally — $339 owed to [person].” When IT pays that person $339, record a repayment linked to the expense. The outstanding balance becomes zero. The expense remains $300 of expense and $39 of possible input tax credit, subject to accountant confirmation and valid supporting evidence.

**Legacy-data clarification:** the user confirmed every expense entered in Books to date was paid with a personal credit card ending in `8833`; none has yet been repaid from a company account. Google Ads to date was also paid with that card. The cardholder is confirmed as Ankit Malhotra. Backfill legacy records with that recipient and display the last four digits, but keep actual personal payment dates unconfirmed unless a source transaction establishes them. Google Ads daily spend dates are not the same as card debit dates; use Google Ads payment history or the card statement to record actual debit dates. A new corporate card is now available for business-paid expenses going forward.

## 2. Documentation and codebase discovery

### Sources consulted

- `prisma/schema.prisma:452-508` — legal-entity separation and entity-scoped memberships/permissions.
- `prisma/schema.prisma:510-562` — current entity-scoped expense/category schema, payment fields, receipt evidence, and available indexes.
- `prisma/schema.prisma:592-718` — partner billing snapshots/invoices and audit-event patterns; current partner profit formula is stored separately from Books expenses.
- `src/app/api/books/expenses/route.ts:132-208` — authenticated entity-scoped expense creation, cents-based amount validation, category ownership checks, S3 receipt handling, transaction and audit event.
- `src/app/api/books/expenses/[id]/route.ts` — existing expense edit/void flow and entity isolation.
- `src/app/books/page.tsx:180-240,549-580` — client state, role/entity selection, expense summary/ledger, add/edit expense form, receipt and Gemini review controls.
- `src/lib/accounting-auth.ts:120-198` — entity-scoped access checks, Admin/Dispatcher restrictions, membership capability checks, and invoice privilege rules.
- `src/lib/books-api.ts` — shared money parsing/serialization, date parsing, entity-code validation patterns.
- `src/lib/accounting-receipts.ts` and `src/app/api/books/expenses/receipt-draft/route.ts` — private receipt storage and short-lived AI parsing draft patterns.
- `prisma/books-accounting-migration.sql:1-67,118-130` — additive, rerunnable SQL migration conventions and audit-event schema.
- `tests/accounting.test.ts` and `tests/accounting-invoice-pdf.test.ts` — focused accounting calculation and document tests.

### Current constraints and allowed patterns

- `AccountingExpense` already stores the legal entity, expense date, amounts, expense category, payment method, receipt metadata, creator/updater, and void timestamp. New payment/reimbursement data should remain scoped through its expense's entity.
- Expense creation currently forces `paymentStatus: 'PAID'` and sets `paidAt` to the creation time (`src/app/api/books/expenses/route.ts:189-192`), while the current form still displays an “Unpaid / Paid” selector (`src/app/books/page.tsx:580`). This is a UI/API mismatch as well as a missing personal-funding path. The new UI should replace that selector with “Who paid?” and keep the existing product rule that only expenses already paid to the vendor are entered; do not reintroduce a generic unpaid vendor-bill workflow.
- Follow the current pattern of accepting money as integer cents, validating `total = subtotal + HST`, and persisting through `centsToDecimal` (`src/lib/books-api.ts`, `src/app/api/books/expenses/route.ts`).
- Keep all reads and writes entity-scoped using `getAccountingEntityAccess`; never accept an entity ID as authorization from the browser.
- Keep receipt files private in the existing S3 bucket and continue to treat Gemini values as suggestions requiring user review. AI must not guess who paid, reimbursement amounts, or accounting mappings.
- The dispatcher currently has expense-management access only to Locksmith books; they must not gain any route, summary, or repayment data access to IT & Marketing (`src/lib/accounting-auth.ts:134-152`).
- Use an additive Prisma/schema migration, transaction-backed write plus audit event, and existing responsive Books UI patterns. Do not introduce a general ledger or bank-feed integration as part of the initial reimbursement release.

### Accounting boundary to preserve

The portal should record operational facts (what was bought, which company benefited, who paid, how much the company repaid, and evidence). It should support an accountant assigning the correct liability/account and tax treatment. It should not automatically decide whether a pre-incorporation cost is deductible, capitalizable, an eligible HST ITC, a shareholder loan, or an employee payable. Those treatments can depend on the facts and accountant's advice.

## 3. Proposed user experience

### Add a personal-paid expense

In the current “Record a company expense” flow, replace the ambiguous payment status question with a short “Who paid?” choice:

- **Company paid** — retain the current payment method/date path and show “Paid by the business.”
- **Paid personally** — ask for the person's name, payment method (personal credit card, personal debit, cash, or other), and original payment date. Show a plain-language confirmation: “This will add $X to the amount this company owes [person].”

Both paths keep the receipt upload/AI alternate path, vendor, business purpose, expense date, category, subtotal, HST, total, and notes. For fees incurred before the business bank account existed, allow separate expense date and personal payment date, and provide an optional “Before incorporation” flag or “Business bank account not open yet” context only after the user clarifies which distinction they need. Do not infer pre-incorporation status from a payment date.

### Reimbursement dashboard and history

Add a compact **Personal expenses to repay** summary and a detail view/filter grouped by payee within the selected entity. Show total owed, partially repaid, repaid, and unreconciled/mapping-needed counts. Each expense row shows original amount, paid-by person, amount repaid, balance remaining, receipt status, and mapping status.

Provide **Record repayment** from a payee's outstanding items. One business-bank transfer can cover one or more expenses for the same person. The user selects the outstanding expenses and enters the actual transfer amount, date, source business account/last four or account label, payment method, bank transaction reference, and note. Preallocate the amount across selected expenses and display the allocations before saving. Allow partial repayment and multiple repayments over time. Reject any allocation that exceeds its expense's open balance.

The event history for each expense shows created/edited, receipt attached or replaced, repayment recorded, allocation changes, and voids, with actor and timestamp. Do not permit silent deletion of a repayment; corrections should be an audited reversal/void followed by a corrected entry.

### Accountant mapping view

Add accountant-friendly filters/columns or a simple **Needs accountant mapping** queue. For each reimbursement-related expense and payment, let an authorized accountant record the mapped liability/account name and optional account code, classification/tax treatment notes, and mapping state (`Not reviewed`, `Needs clarification`, `Mapped`). Keep mapping entity-specific and visible in CSV/export. Preserve who mapped it and when. The admin can see and correct mappings; the Locksmith dispatcher should see the operational balance for Locksmith but cannot view or map IT & Marketing.

## 4. Phased implementation

### Phase 1 — Confirm accounting vocabulary and access rules

**What to implement**

- Confirm which individuals can be reimbursed, whether one repayment commonly covers multiple receipts, and the accountant's desired bookkeeping labels for amounts owed.
- Represent “personally paid and owed” separately from the existing generic expense `paymentStatus`; avoid interpreting `PAID` as “the company has reimbursed the person.”
- Set the initial accountant mapping contract: record facts and allow mapping, but leave tax/deductibility decisions to the accountant.
- Specify visibility: Admin for both entities; Dispatcher only for Locksmith; Accountant only for the entity memberships and explicit capabilities granted to that accountant.

**Documentation references**

- Follow entity scoping and membership capability patterns in `prisma/schema.prisma:490-507` and `src/lib/accounting-auth.ts:120-198`.
- Follow the product's defined boundary that biweekly profit comes from operational revenue, HST, COGS, and technician commissions in `prisma/schema.prisma:592-628`; reimbursement entries must not alter it.

**Verification checklist**

- Review the terms “paid personally,” “owed,” “repaid,” and “pre-incorporation” with the accountant before implementation labels are frozen.
- Verify the planned permission matrix for Admin, Dispatcher, and Accountant against both company entities.

**Anti-pattern guards**

- Do not call all personal payments a “shareholder loan” by default; the payer could have a different relationship and the accountant may use a different account.
- Do not infer that an expense predates incorporation merely because the company had no bank account yet.
- Do not grant Dispatcher access to IT & Marketing while enabling personal expense tracking.

### Phase 2 — Entity-scoped data model and additive migration

**What to implement**

- Extend `AccountingExpense` with a clear funding source (`BUSINESS` or `PERSONAL`), a personal payee identity when applicable, the personal payment method/card last four digits, and the actual date the original expense was paid. Backfill all rows present at migration time as personal-credit-card funded with last four digits `8833`; leave payee and actual card-charge date unconfirmed where not recorded. New records after migration may be business-funded or personal-funded.
- Add a reimbursement payment record representing an actual outgoing payment from the business, with entity, payee, payment date, amount, method/source-account label, external bank reference, note, creator, and void/reversal metadata.
- Add reimbursement allocations linking one payment to one or more expenses. This supports a transfer covering multiple receipts and partial payments without duplicating expense records. Enforce that an allocation belongs to the same entity and payee as the underlying expense and cannot exceed its unpaid reimbursable balance.
- Add mapping fields or an entity-scoped mapping relation for liability account name/code, accountant notes, mapping state, mapped-by user, and mapped-at timestamp. Keep fields nullable so legacy records need no fabricated mapping.
- Add audit event actions and indexes for entity/date, payee/open balance, payment-to-allocation, and mapping review queries. Preserve deleted/voided history instead of destructive deletes.
- Keep SQL migration additive and rerunnable in the style of `prisma/books-accounting-migration.sql`.

**Documentation references**

- Copy current expense entity/category/receipt ownership patterns from `prisma/schema.prisma:510-562`.
- Copy payment history and immutable event/audit patterns from `prisma/schema.prisma:680-718`.
- Copy the `BEGIN`/`ALTER ... ADD VALUE IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS` migration style from `prisma/books-accounting-migration.sql:1-67,118-130`.

**Verification checklist**

- Confirm every legacy record is marked as paid from personal card ending `8833` and outstanding, without inventing cardholder or historical charge date; it appears in the needs-recipient queue until those details are supplied.
- Confirm migration reruns never convert post-migration company-funded expenses into personal-card expenses.
- Confirm a personal-funded expense creates a payable balance exactly equal to its reimbursable total; all money persists in `Decimal(12,2)` and API values use integer-cent validation.
- Confirm one repayment can allocate across several expenses, and several partial repayments can settle one expense.
- Confirm the database cannot accept cross-entity allocations or a payment exceeding an expense's remaining balance.
- Confirm voided payments and expenses remain auditable and do not count as active outstanding balances.

**Anti-pattern guards**

- Do not create a second `AccountingExpense` for repayment; repayment is liability settlement, not a second expense.
- Do not calculate a person's balance only from a mutable field on `AccountingExpense`; derive it from payment allocations so history reconciles.
- Do not use floating point for allocation totals or silently round partial cent values.

### Phase 3 — Expense entry and edit flow

**What to implement**

- Update the expense form and API so the user selects who paid. For personal funding, require the reimbursable person and actual personal payment method/date; for business funding, preserve today's path.
- Carry the funding selection through both manual entry and the Gemini receipt review flow, but require a human to choose payer/funding source. Keep AI-parsed vendor/date/amount suggestions reviewable.
- Show derived “Owed to [person]” or “Repaid” status and balance on expense rows/details. Do not overload the existing expense `PAID` badge; label the original payment source and reimbursement state separately.
- Allow edits to payee/funding only while no reimbursement is allocated, or require an audited correction workflow once repayments exist. Recalculate HST/total using the existing validation rules.
- Continue requiring the same receipt attachment or documented missing-receipt explanation and retain private authenticated receipt access.

**Documentation references**

- Follow API body parsing, entity/category validation, receipt upload lifecycle, transaction handling, and audit creation in `src/app/api/books/expenses/route.ts:132-208`.
- Follow edit/void protections in `src/app/api/books/expenses/[id]/route.ts`.
- Extend the controlled expense form/state in `src/app/books/page.tsx:180-240,580` and the ledger item in `:555-560`.
- Follow review-before-save AI extraction in `src/app/api/books/expenses/receipt-draft/route.ts` and its client flow.

**Verification checklist**

- Create each combination: IT vs Locksmith, business-funded vs personal-funded, with/without HST, receipt upload vs Gemini suggestion.
- Ensure the same expense appears once in totals and does not change partner profit snapshots or the operational revenue pages.
- Confirm all edits are rejected across entity boundaries and personal fields cannot be omitted for personal-funded records.
- Confirm a personal-funded setup fee can use an earlier expense date and a different payment date.

**Anti-pattern guards**

- Do not have Gemini decide the funding source, recipient, HST eligibility, GL account, or whether a fee is capitalizable.
- Do not use `paidAt = new Date()` to represent the historic personal payment date.
- Do not expose S3 storage keys or make receipt objects public.

### Phase 4 — Repayment capture, balances, and transaction history

**What to implement**

- Add entity-scoped API routes to list outstanding personal-paid amounts and create/list/void repayment transactions with allocations.
- Add a user-friendly outstanding balance panel grouped by person, with filters for outstanding, partial, repaid, date range, and missing accountant mapping.
- Add a repayment modal showing selected expenses and open balances, actual transfer amount/date, payment method, source business-account label, transaction reference, and allocation preview. Support partial repayment and one transfer for multiple selected expenses.
- On save, create the transaction and allocations atomically, create audit records, and update derived statuses on refresh. Use an idempotency/concurrency-safe database transaction so parallel updates cannot overpay an expense.
- Add optional evidence upload for bank transfer/statement proof using the existing private S3 receipt storage pathway; allow reference-only if no file is available.
- Make void/reversal Admin-only initially, require a reason, preserve the original record, and restore balances based on active allocations.

**Documentation references**

- Follow entity authorization and request logging from `src/app/api/books/expenses/route.ts` and `src/lib/accounting-auth.ts`.
- Follow atomic data-plus-audit write patterns in `src/app/api/books/expenses/route.ts:176-208` and payment history in `prisma/schema.prisma:680-695`.
- Reuse date-only parsing and cents conversion from `src/lib/books-api.ts`.

**Verification checklist**

- Prove partial repayments, multiple repayments, one repayment across multiple expenses, exact full repayment, and overpayment rejection.
- Prove two simultaneous repayment attempts cannot allocate more than the open balance.
- Prove voiding/reversal returns the correct amount to outstanding and remains visible in history.
- Confirm the expense ledger total is unchanged when a repayment is recorded; only the outstanding payable decreases.
- Confirm a Locksmith Dispatcher can create/see Locksmith repayments but receives 403/404 for IT & Marketing records and routes.

**Anti-pattern guards**

- Do not mark a repayment successful until the corresponding allocation transaction commits.
- Do not delete and recreate history during correction; write reversals and replacement entries.
- Do not label a repayment “expense paid” where that could be confused with the original vendor payment.

### Phase 5 — Accountant mapping, reporting, and exports

**What to implement**

- Add an accountant review queue for uncategorized expenses, unassigned reimbursement liability account, and unmatched/unclear repayment reference.
- Let Accountant users view the entities granted by `AccountingEntityMembership`; grant only explicit read/mapping abilities by default. Do not permit accountant users to issue invoices or mark partner invoice payments unless separately authorized by existing Admin-only policy.
- Provide entity-scoped CSV export with original expense details, HST, payer, amount owed, repayment transaction ID/date/reference, allocation amount, open balance, receipt filename/status, mapping account name/code, mapping status, notes, and audit dates.
- Provide a period summary showing opening owed balance + new personal-paid expenses − repayments ± voids = closing owed balance, grouped by person and entity. Keep it separate from revenue, partner profit, and invoice metrics.
- Make changes to accountant mappings auditable; show who mapped it and when.

**Documentation references**

- Follow membership capability patterns in `prisma/schema.prisma:490-507` and role guard structure in `src/lib/accounting-auth.ts:176-198`.
- Follow existing entity expense, invoice, and period serialization patterns in `src/app/api/books/expenses/route.ts`, `src/app/api/books/periods/route.ts`, and `src/lib/books-api.ts`.

**Verification checklist**

- Reconcile the displayed opening/new/paid/closing formula against raw expense and repayment allocations for each entity and selected period.
- Confirm a mapping update cannot change expense, HST, or cash totals.
- Confirm exports contain no cross-entity records and preserve cents/date values exactly.
- Confirm accountant can only see entity memberships and allowed mapping actions; Dispatcher cannot access IT & Marketing.

**Anti-pattern guards**

- Do not add a complete general ledger, bank-feed sync, automatic CRA filing, or automatic tax eligibility decision to this slice.
- Do not share one liability-account mapping across both corporations by default; mappings are entity-specific.
- Do not make the accountant's selected mapping a claim that CRA treatment has been validated by the portal.

### Phase 6 — Backward-compatible rollout and verification

**What to implement**

- Deploy the additive schema migration before application code that reads new columns/tables.
- Backfill all existing expense rows as unreimbursed personal-credit-card funded (`8833`) once, while leaving cardholder name and original charge date unconfirmed until supplied. Do not rerun this backfill over new records.
- Allow Admin or the entity's expense manager to assign the confirmed recipient and actual transaction date to legacy rows; write an audit event for the confirmation.
- Add focused tests for money arithmetic, allocation and entity isolation, API permissions, reversals, receipt flow, and reporting reconciliation. Add UI coverage for manual, personal-funded, and repayment workflows.
- Verify through staging with one example per company before enabling production writes; prepare rollback notes that retain the additive schema and hide the new UI if an application rollback is needed.

**Documentation references**

- Follow the production Books migration rollout notes in `README.md:131-151`.
- Follow existing test conventions in `tests/accounting.test.ts`, `tests/accounting-invoice-pdf.test.ts`, and current Books API tests if present.

**Verification checklist**

- Run Prisma validation/client generation, focused accounting/API/UI tests, the full test suite, and production build.
- Exercise Admin + Locksmith Dispatcher + Accountant test users against both entity books.
- Validate an end-to-end example: personal accounting fee entered once, receipt attached, $100 partial transfer, remaining balance shown, second transfer settles it, accountant maps expense/liability, CSV reconciles, and operating profit is unchanged.
- Confirm an older expense displays as outstanding personal-card funded (`•••• 8833`) and requires recipient/date confirmation before reimbursement, while new corporate-card expenses can be entered as business-paid and existing invoice/receipt workflows still work.

**Anti-pattern guards**

- Do not make migration rollback delete user-created reimbursement or accounting history.
- Do not enable live bank transfers from this feature; it records transfers performed outside the portal.
- Do not change the separate operational portal's revenue numbers or the biweekly profit snapshot formula.

## 5. Open decisions before implementation

1. **Who owns personal card ending 8833?** This name is needed to identify the person owed on all existing expenses. Until confirmed, show those balances as unassigned and block repayment allocation to a named recipient.
2. **Who else can receive reimbursement?** Recommended: a selectable, entity-specific person list (partners/directors/accountants/other) with a safe “add person” action. Should both partners be available in both entity books, or are reimbursement payees different per corporation?
3. **Does a single bank transfer often repay several expense receipts?** The plan supports this, because bank statements show one outgoing transaction while the accountant needs receipt-level allocations. If it is always one transfer per expense, the allocation UI can be simpler while keeping the same data model.
4. **Pre-incorporation wording:** were setup/accounting fees paid before incorporation, or after incorporation but before the corporate bank account opened? These are different facts. Recommended: store the actual expense date and payment date, plus a factual “before incorporation” flag; let the accountant decide the accounting and HST treatment.
5. **Account mapping:** should the accountant choose from a short admin-maintained list of liability accounts, or enter account name/code per record? Recommended MVP: free text with optional code and autocomplete from previous entity-specific entries; add a chart-of-accounts manager only if the accountant needs it.

Until those choices are confirmed, the implementation can proceed with per-entity payee name, multi-expense repayment allocations, factual dates/flags, and accountant-entered account name/code as the defaults above.
