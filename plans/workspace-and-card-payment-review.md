# Review: workspace redesign and completed-job card payments

October 7, 2026 · Branch `codex/admin-dispatch-workspace-redesign` at `d09f601`, plus the uncommitted job/Stripe partner-billing refresh edits in the working tree.

## Implementation status (October 7, 2026)

Done in this branch (not yet committed):
- **Fixes:** #2 (sidebar "Completed job" no longer reopens a previous edit; close/cancel clears edit state), #3 (Send SMS after regenerating a link), #4 (test mock; the test is now `tests/manual-card-link-route.test.ts`). #1 no longer applies to new jobs, because card links don't use `LOCKSMITH_DUAL_PRICING_APPROVED`.
- **Pricing decision:** the dispatcher enters one final card total (HST and the card fee included). The customer is charged exactly that, and the bill shows subtotal + HST with no separate fee line. Stored as `pricingModel = CARD_TOTAL_V1`.
- **5.1:** the form has a single *How was it paid?* choice and a **Save & text payment link** button that opens the SMS draft straight away (no Stripe call at save).
- **5.2:** a public `/pay/<token>` page with a stable link. It creates Stripe Checkout on demand (service + HST lines, no Stripe Tax), reuses an open session, and expires stale ones. The webhook keeps the portal HST and refuses a payment that doesn't match the saved total. Customer acceptance is not captured, since there is no separate card price shown.
- **5.3:** Dashboard **Awaiting payment** card, and a Jobs desk **Payment follow-up** list with **Resend link** and **Paid another way**.
- Old `/pay/[id]` placeholder removed.

Not done: #5 (local `.env` live key, which you need to change), #6/#7 (low priority; #6 is moot for new links), 5.5 (process agreement), browser walkthrough with real data.

## Summary

The redesign (Phases 1–4 and 6, with Phase 5 deferred) holds up against both the plan and the code. The build passes, `tsc` is clean, and 35 of 36 unit test scripts pass. The one that fails, `manual-dual-price-route`, is a stale test mock, not a broken route.

The completed-job → card payment link flow works end to end in code, but:

- **Every link will fail** unless `LOCKSMITH_DUAL_PRICING_APPROVED=true` is set in production. The dispatcher only finds out *after* the job is saved.
- There are **two UI bugs**, one of which can overwrite the wrong job.
- The flow has **more steps than it needs**. Section 4 compares it with Jobber, Housecall Pro, ServiceTitan and Workiz. Section 5 proposes a one-choice, one-button flow with a payment link that doesn't expire.

## 1. Fix before relying on card links

| # | Severity | Issue | Where | Fix |
|---|---|---|---|---|
| 1 | **High (config)** | The payment-link API returns 503 unless `LOCKSMITH_DUAL_PRICING_APPROVED=true`. `DEPLOYMENT.md` says to keep it `false` until the processor and accountant review it. The local `.env` doesn't set it. The UI still lets a dispatcher save a Pending card job and offers "Generate payment link?", which then fails. | [payment-link/route.ts:87](../src/app/api/jobs/[id]/payment-link/route.ts) | Check the Vercel env value. If approval is done, set it to `true`. If not, hide the "card link" option in the form while the flag is off. Option A in 5.4 removes the need for the flag. |
| 2 | **High (data)** | The Completed-job modal can open in **edit mode for a previous job**. Steps: on `/dispatch`, click Edit on a manual job, then close with × or Cancel. Then use the sidebar's **New job → Completed job**. The modal shows "Edit Completed Job" with the old job's data, and saving PATCHes that job. The new persistent sidebar makes this easy to hit. | `openIntakeFromLink` [dispatch/page.tsx:293](../src/app/dispatch/page.tsx); close buttons only call `setShowAddJob(false)` | Reset `editingManualId` and the manual form in `openIntakeFromLink` for `COMPLETED`, i.e. reuse `openAddJob`. Also clear `editingManualId` on close/cancel. |
| 3 | Medium | Job page: if a link has **expired** and the user regenerates it **without** SMS, "Send Payment Link via SMS" errors with "No active payment link". The new URL is in `paymentLinkUrlOverride`, but the check still reads the persisted expired status and expiry. | `sendPaymentLinkSms` [dispatch/jobs/[id]/page.tsx:366](../src/app/dispatch/jobs/[id]/page.tsx) | Skip the persisted-expiry check when `paymentLinkUrlOverride` is set, or update `stripeSessionStatus`/`stripeSessionExpiresAt` in local job state after generation. |
| 4 | Medium (test) | `tests/manual-dual-price-route.test.ts` crashes (`Cannot find package '@/lib'`). The uncommitted route edit imports `@/lib/partner-billing-snapshot-refresh`, which the test does not mock. With the mock added, all 3 tests pass (checked with a temporary copy). | test line 21 | Add the module to `mocks` with a no-op `refreshUnissuedPartnerBillingSnapshots`. Commit it with the job-route edits. |
| 5 | Medium (ops) | Local `.env` has a **live** Stripe secret key (`sk_live…`), and `NEXT_PUBLIC_APP_URL` is defined twice (http and https). Testing payment links locally would create real Checkout sessions, with return URLs that depend on which duplicate wins. | `.env` | Use `sk_test…` and a test webhook secret locally. Keep a single `NEXT_PUBLIC_APP_URL`. |
| 6 | Low | Every edit of a pending card job re-stamps `quoteAcceptedAt = now` and `quoteAcceptedById = editor`. The checkbox is pre-ticked on edit, so the acceptance record moves to whoever last edited, even if pricing didn't change. | [manual/[id]/route.ts:320](../src/app/api/jobs/manual/[id]/route.ts) | Keep the original acceptance unless price, rate, or method changed. |
| 7 | Low | The Stripe Checkout session is created *before* the DB transaction. If the transaction then conflicts (409), the open session is never expired. The customer never received it, so the risk is low. | payment-link route | On `PaymentLinkStateChangedError`, call `expireStripeCheckoutSession(result.sessionId)`. |

What I verified as correct:
- Server-side validation of the 4% cap and the acceptance evidence.
- Optimistic concurrency on link creation and manual edits.
- Expiring the old Stripe session when quote fields change.
- The paid-Stripe lock on edit/delete.
- Webhook dedupe and "paid wins".
- Reports count **PAID** invoices only, so pending card jobs don't inflate revenue before payment.
- Partner-billing snapshot refresh on paid changes (uncommitted).

## 2. Redesign review (beyond the plan)

| Area | Status | Gap / suggestion |
|---|---|---|
| Menu, gates (`/dashboard`, `/google-ads`, `/admin`, `/api/dashboard*`) | OK in middleware and handlers | Signed-in smoke checks (`SMOKE_ADMIN_*`, `SMOKE_DISPATCHER_*`) have **not** been run, and the pages haven't been clicked through in a browser. Do one pass on staging. |
| Dashboard | OK | **Gap:** completed jobs awaiting card payment don't appear on the Dashboard. They show only in the Jobs desk's payment-attention list. Add a "Card payments pending" row (count, oldest age, expired-link count) linking to the Jobs desk filtered to pending. |
| Books task routes | OK (view-scoped legacy workspace) | Manually check expense with receipt, repayment and invoice issue in both entities. These have no UI tests. |
| Google Ads | OK | Spend stays hidden until `GOOGLE_ADS_METADATA_VERIFIED=true`. Set it with the currency and time zone in Vercel. |
| `/api/owner/analytics` | Orphaned | Still returns `companyRoas`/`partnerRoas` with the old meaning. Remove it. |
| Uncommitted job/Stripe edits | Build OK | Commit them with fix #4. They are needed so partner billing periods refresh when jobs are paid, edited or deleted. |

## 3. How card payment works today

The dispatcher enters the job after it is done:

1. New job → Completed.
2. Fill in the job details, technician, COGS and commission.
3. Payment method **Credit card** (or Debit) **and** Payment status **Pending**. These are two separate choices, and nothing explains that this combination means "send a link".
4. Card-price difference % (default 4%), "customer accepted card price" checkbox, Verbal/Written, and a free-text acceptance note.
5. Save Completed Job.
6. Prompt: "Generate payment link?" → Yes.
7. SMS draft opens → Send in Messages.
8. If the customer doesn't pay within about 24 hours, the link expires. Someone has to notice, open the job and regenerate it.

That is 4 extra decisions and 2 extra confirmations on top of a cash entry, and the step that can fail (the env flag) runs last.

## 4. How other field-service platforms do it

Researched October 7, 2026, from each vendor's help centre.

| Platform | On site | After the visit | How "paid" is recorded |
|---|---|---|---|
| **Jobber** | Open invoice → *Collect Invoice* → Tap to Pay on the tech's phone (no reader) | *Request Online Payment* sends the invoice; the client pays in the Client Hub (card, Apple/Google Pay) | Automatic; receipt emailed |
| **Housecall Pro** | Card on the app or reader | Invoice → *Text* → customer gets a secure link and pays on their phone | Automatic: job marked paid, money deposited |
| **ServiceTitan** | Tap to Pay on Mobile | Tech sends an SMS or email invoice link from the app (admin enables it once) | Automatic; the tech gets a "paid" text |
| **Workiz** | Workiz Pay: Tap to Pay, manual card entry, card on file, reader | Job → Finances → *Send payment link* (text or email) → client portal | Automatic; the team is notified and payment is logged on the job |

**Patterns all four share, and how we compare:**

1. **There is no "payment status" field for the user.** Every platform has one action, *Collect payment* or *Send payment link*, and the status follows from it. Here, the dispatcher has to pick *Credit card* + *Pending*.
2. **The payment link is a stable customer page** (Client Hub, invoice page or portal) that stays valid until paid. It is not a 24-hour card-processor session. Our Stripe Checkout URL dies after 24 hours (Stripe's maximum), which is why we have expiry and regenerate steps.
3. **Sending is one tap from the job or invoice,** with no separate generate-then-confirm step.
4. **Payment confirmation is automatic** and pushed to the team. We already auto-record payment through the webhook, but nobody is told and the Dashboard doesn't show unpaid jobs.
5. **Collecting on site is the default**, with links as the fallback. Our technicians don't use the portal; only the dispatcher updates jobs. So the link is our only card path, and *when* it is sent matters most (see 5.5).
6. None of them asks staff to type evidence that the customer accepted a card price. Where a card price differs, the customer sees it on the payment page before paying.

## 5. Recommended design: "Text payment link" with a stable pay page

### 5.1 Dispatcher flow (target)

1. New job → Completed → details as today.
2. **Payment:** `Cash` · `Interac` · `Card – paid on site` · **`Card – text customer a link`**. One control replaces method, status, % and the acceptance fields.
3. Click **Save & text link**. The job is saved as Pending and the SMS draft opens straight away with `https://<portal>/pay/<token>`. **No Stripe call happens at save time**, so a Stripe or config problem can't block saving or the SMS.
4. Done. When the customer pays, the webhook marks the job paid, and it disappears from the Dashboard's "Awaiting card payment" row.

That is 1 choice and 1 button, the same effort as a cash entry.

### 5.2 Customer pay page (`/pay/<token>`, new, public)

- Shows: business name, Job #, service, date, and the amount. If dual pricing stays, it shows both prices and the customer ticks "I accept the card price of $X".
- Clicking **Pay by card** creates the Stripe Checkout session *at that moment* (reusing `createStripePaymentLink`) and redirects. The SMS link therefore never expires: it creates a fresh session whenever it's opened, until the job is paid or cancelled.
- If already paid: "Paid on <date>" plus a receipt link. If the job was edited: the page shows the current amount, because the existing "expire open session on edit" logic still applies.
- **Customer acceptance is recorded on this page** (time, IP/user agent, price shown), which is stronger evidence than a dispatcher's note. `quoteAcceptanceMethod = 'CUSTOMER_PAY_PAGE'`. The dispatcher form no longer needs the checkbox, verbal/written choice or note.
- Security: a random 32-byte token stored hashed on the invoice; no login; only first name, Job #, amount and service shown; rate-limited; the token stops working once paid or voided.

### 5.3 Team follow-up

- Dashboard row **"Awaiting card payment: N jobs · $X · oldest N days"**, linking to the Jobs desk filtered to pending.
- Pending row actions: **Resend link** (same URL, opens an SMS draft) and **Paid another way** (switches to Cash, Interac or on-site card).
- Optional: an in-app or email notice to the dispatcher when a link is paid. The SMS rule still applies: there is no portal-sent SMS.

### 5.4 Pricing decision needed before building (owner + accountant)

The current link always charges a **card price up to 4% above the non-card price**, for both credit *and debit*. Published guidance on Canadian card rules says:

- Credit surcharges were allowed from October 2022 under the Visa/Mastercard settlement, capped at roughly **2.4%** (sources differ on Visa's cap).
- Merchants must notify the networks about 30 days ahead, and disclose the surcharge before payment.
- **Surcharging debit/Interac is not allowed.**
- Quebec prohibits surcharges.

Whether "dual pricing" counts as a surcharge is a question for the processor and accountant; this is not legal advice. It is likely why `LOCKSMITH_DUAL_PRICING_APPROVED` is still off. Options:

| Option | Simplicity | Notes |
|---|---|---|
| **A. One price; card fee absorbed** (≈2.9% + 30¢ online at Stripe) | Simplest: no %, no acceptance step, no flag | What most platforms do by default. Can ship immediately. |
| B. Credit surcharge ≤ the allowed cap, shown as a line on the pay page | Medium | Needs network notice and a way to exclude debit. Checkout can't easily price by card type. |
| C. Keep dual price (current) | Most complex | Blocked on approval; debit exposure remains. |

**Recommendation:** ship the link flow with **Option A** now, and switch to B later only if the accountant approves and the fee matters. This removes the approval flag, the % field and the acceptance evidence from the dispatcher's path entirely.

### 5.5 Get paid before the technician leaves (process, no technician app)

Technicians don't use the portal; the dispatcher enters every job. Tap to Pay and a technician QR button are therefore not options. The goal stays the same: the customer pays while the technician is still there. The pay-page design makes this a process change, not a feature:

1. When the work is done, the technician calls or texts the dispatcher with the amount, as they already do to report the job.
2. The dispatcher enters the completed job and taps **Save & text link** right away. This takes under a minute, because there is now only one payment choice.
3. The customer receives the SMS while the technician is still there, and the technician asks them to pay now. The webhook marks it paid, and the dispatcher can see it is paid before the technician drives off.
4. If the customer can't pay then, the same link keeps working. The Dashboard "Awaiting card payment" row is the follow-up list.

Optional, small: on the dispatcher's success screen after saving, show the `/pay/<token>` link as a **QR code**. If the technician has the dispatcher on video, or the customer is on the phone with the dispatcher, it gives another way in. Skip it if it isn't needed.

Not recommended: the dispatcher typing card numbers read over the phone (for example in Stripe's Dashboard virtual terminal). It brings card data into the dispatcher's hands, with PCI and dispute risk, and the link already covers this case.

If technicians start using a phone app later, the same `/pay/<token>` page becomes their "Show pay QR" with no new backend work.

### Suggested order
1. Fixes #1–#4 (section 1). For #1, the decision in 5.4 may make the flag irrelevant.
2. Owner and accountant pick the pricing option (5.4).
3. One PR: the single payment control + *Save & text link* + the `/pay/<token>` page + Dashboard "Awaiting card payment" row. This needs one additive SQL file (`Invoice.payTokenHash`, plus nullable acceptance metadata if dual pricing is kept), and `/pay` stays outside the middleware matcher.
4. Resend / Paid-another-way actions. Agree the "text the link before the technician leaves" routine with dispatchers and technicians (5.5).

Sources: [Jobber Tap to Pay](https://help.getjobber.com/hc/en-us/articles/8354601698583), [Jobber Payments](https://help.getjobber.com/hc/en-us/articles/115009730148), [Housecall Pro pay by text](https://help.housecallpro.com/en/articles/2886632-send-customers-pay-by-text-option), [ServiceTitan SMS invoice links](https://help.servicetitan.com/commercial/docs/use-sms-invoice-payment-links), [ServiceTitan mobile payment link](https://help.servicetitan.com/how-to/email-payment-link-mobile), [Workiz payment links](https://help.workiz.com/hc/en-us/articles/28548922225809), [Workiz Pay](https://help.workiz.com/en/articles/7174047-collecting-payments-using-workiz-pay-on-the-mobile-app), [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions), [Paystone: Canadian surcharge guide](https://www.paystone.com/resources/should-you-add-a-credit-card-surcharge-the-canadian-business-owners-honest-guide), [Adyen surcharge compliance](https://docs.adyen.com/development-resources/surcharge-compliance).

## Verification run for this review

- `npx tsc --noEmit`: clean.
- `npm run build`: passed (working tree including the uncommitted job/Stripe edits).
- Unit tests: 35/36 scripts pass. `manual-dual-price-route` fails on the missing mock and passes 3/3 with it added. `e2e`, `production-e2e` and `workspace-smoke` were not run because they need a server or seeded DB.
- Not done: browser walkthrough; signed-in smoke checks; a real Stripe test-mode payment (needs `sk_test` locally).
