# Clear the Q competitive review for LockOps Pro

Reviewed October 1, 2026 in the signed-in Tamil Chrome profile. This is a product recommendation, not a request to clone the competitor.

## Scope and confidence

I inspected Clear the Q's dispatch board, paste intake, dashboard, jobs, map, calendar, clients, technicians, sources, communications, invoices and estimates, expenses, inventory, reports, trade tools, settlement builder, settings, import, and billing screens. The trial account contained no jobs, clients, sources, invoices, inventory, expenses, or communication history. I opened creation forms but saved no test records. I tested paste intake with synthetic text and stopped before saving; its rules parser put the whole message in the address field and reported only one parsed field. That is one example, not a measured accuracy rate. AI Parse showed a remaining-use quota but was not run. Completed-job behavior, actual messages, exports, settlement runs, payment collection, and technician acceptance could not be validated end to end.

The public marketing site describes more than the signed-in account proves. Settings says Stripe connection and phone number provisioning are coming soon; AI transcription is marked soon. Treat those as roadmap claims. The marketing page says unlimited jobs on every plan, while the signed-in billing screen describes Starter as 500 jobs per month, so plan details should be checked before relying on them.

## Product thesis

Our highest return comes from reducing dispatcher typing, making job ownership visible, and calculating true margin and receivables by job and source. LockOps Pro already has a strong closeout core: technician mobile jobs, signatures and proof photo, Ontario HST calculations, Stripe Checkout links with webhook confirmation, RingCentral call analytics, Google Ads ROI, and cash handover. Clear the Q's strongest ideas improve the front half of the workflow and the operator's daily view.

## 80/20 roadmap

| Order | Recommendation | Why it matters | Effort | First useful version |
| --- | --- | --- | --- | --- |
| 1 | Paste-to-job with review | Saves repetitive intake time for messages from WhatsApp, SMS, partner dispatch, or email | Medium | Deterministic extraction of phone, name, address, job type, appointment, notes; confidence and original text; dispatcher confirms every field before creation. Add AI only for low-confidence cases. |
| 2 | Job acceptance and attention queue | Answers who owns the job and what needs action without chasing calls | Medium | Technician accepts or declines in the existing portal; timestamp the response; show unaccepted, overdue, awaiting payment, and stale jobs on dispatch. Refresh automatically. |
| 3 | Client history and repeat recognition | Converts the existing Customer table into a useful memory and avoids duplicate entry | Small | Search by phone during intake; prefill customer; show last job, notes, and a repeat badge; link to job history. |
| 4 | Source and referral economics | Reveals whether partner jobs are profitable after source fees and technician pay | Medium | Source on each job, default fee/rate, job-level override, source margin, and an open balance report. Start with one fee model actually used by our business. |
| 5 | Scheduling view | Existing scheduledFor data has no calendar workflow | Small/Medium | Day and week agenda, date and tech filters, overdue appointment highlight, direct job open. A map can follow after address quality is measured. |
| 6 | Estimates and follow-up | Creates a path from quote to booked job | Medium | Draft estimate with line items, tax, expiry, sendable PDF/link, status, conversion to job, and manual reminder queue. Automate reminders after delivery works reliably. |

The first four are the 80/20 core. They cover the highest-frequency dispatcher actions and the largest blind spots in job handoff and margin. Scheduling and estimates are the next wave.

## Easy wins to ship first

1. **Attention cards on dispatch:** show unassigned, dispatched but unaccepted, appointments due soon, jobs with no update, and unpaid jobs. Use existing status and timestamps first; add acceptance timestamp when the acceptance flow lands.
2. **Repeat-customer lookup:** the API already reuses customers by phone. Surface matches and history in intake instead of hiding that value in the database.
3. **Job-list usability:** search by job number, name, phone, and address; save useful filters; add a visible source column once source is recorded. Clear the Q offers advanced filters and custom columns, but a few stable presets may serve operators better.
4. **Better scheduled-job list:** today/tomorrow/this week and a clear due-time indicator before building a full calendar.
5. **Share-message controls:** allow dispatchers to choose which details appear in the technician message and add a preview. Keep sensitive customer notes out by default.
6. **Call-to-job link:** let a dispatcher link a RingCentral call to a job and see missed-call follow-up state. Do not present a communications inbox until message sending and delivery are actually integrated.

## Feature-by-feature assessment

| Clear the Q area observed | What the UI does or offers | LockOps Pro today | Recommendation |
| --- | --- | --- | --- |
| Dispatch board | New, scheduled, in progress, needs attention, missed calls, tech availability | Dispatch form/list and RingCentral analytics | **Build** an action-oriented board from existing data; avoid duplicating the owner analytics dashboard. |
| Paste intake | Paste, rule parse, optional quota-limited AI parse, review fields, source and tech selection, payments/parts | Manual call-intake form | **Build first.** Preserve original message and require review; the observed synthetic parse failed to separate fields. |
| Jobs work queue | Search; status, tech, source, date, payment and amount filters; merged/separated rows; customizable columns | Status-filtered jobs and manual-job table | **Improve selectively.** Start with search and operator presets; custom column ordering can wait. |
| Technician handoff | Public site describes link-based one-tap acceptance | Assigned tech has a portal and SMS draft; no acknowledged delivery | **Build** accept/decline and response timestamps using existing authenticated tech accounts. |
| Dashboard and reports | Revenue, open/unpaid jobs, trends, tech/source splits, money flow, aging, balances, comparisons | Revenue, HST, profit, technician ledger, RingCentral and Google Ads analytics | **Extend** with source margin, open receivables, and operational aging; retain current tax and ad reporting strengths. |
| Clients | Searchable client book; account, billing, payment terms, repeat-client focus; one-time clients hidden by default | Customer records are reused by phone, without a dedicated client UI | **Build** a compact profile/history. Defer account-number and complex billing defaults until needed. |
| Sources | Source contact/rate plus per-source parser signals, dispatch phone, separators, sample paste | No operational source entity on jobs | **Build** source first, then source-specific parsing rules and source balances. |
| Calendar | Month view with day detail | Scheduled date/time on jobs and list filter | **Build** an agenda first; add week/day calendar after use confirms the need. |
| Map | Active jobs by tech/status | One-tap navigation for techs; no dispatch map | **Later.** Requires reliable geocoding and an actual dispatch decision use case. Avoid live tracking until operational value and consent are clear. |
| Communications | Tabs for calls, SMS, WhatsApp, Telegram, notes, missed calls; empty account showed no thread | RingCentral call analytics; device SMS drafts, no sent-message verification | **Phase later.** Link calls to jobs first. A unified thread must have real channel ingestion and delivery state. |
| Invoices/estimates | Independent documents, client/job association, lines, tax, tracked link/PDF options, reminder settings | Job invoice/Stripe payment link; Books partner invoices | **Build estimates** and quote conversion. Keep financial domains clear to avoid duplicate invoices. |
| Expenses and receipt scan | Categorized expenses, vendor, tax-deductible flag, receipt OCR | Separate Books module with expense and receipt OCR workflow | **Already strong.** Add job linkage only when it improves job margin, without merging accounting ledgers blindly. |
| Inventory | SKU/barcode, stock/minimum, purchase cost, supplier, location, scan invoice | Job parts are entered at closeout but no stock ledger | **Later.** Start with a small parts catalog and job-level cost; stock transfers and van inventory require process discipline. |
| Settlement builder | Source-specific CSV/XLSX/HTML parser wizard | Technician cash handover; partner billing in Books | **Conditional.** Build only for a real recurring partner settlement file; prototype one format first. |
| Settings and permissions | Business profile, tax/fees, alerts, templates, role matrix, phone lines, invoice design, team | Role-based access, fixed Ontario tax logic, staff management | **Selectively adopt.** Add permissions only for concrete role conflicts; add alert rules after event reliability. Invoice theme galleries are low value. |
| Trade tools | Working locksmith MACS/bitting calculator plus other trades | Locksmith detail fields on jobs | **Low priority.** One reliable locksmith calculator may help retention, but does not solve dispatch throughput. |
| Import | Guided source selection, mapping, preview, then import | No comparable operations import | **When onboarding external firms.** The preview and rollback story matter more than many source presets. |
| AI receptionist, phone and AI features | Marketed as add-on; phone provisioning and AI transcription marked coming soon in this account | RingCentral integration exists | **Do not copy yet.** Validate call volume, missed-call value, reliability, and unit economics first. |

## Suggested sequence and validation

**Phase 1 — operator speed:** measure current intake time and retyping; ship customer lookup, job search, attention queue, and source field. Pilot with dispatchers. Success signals: shorter median intake time, fewer duplicate customers, fewer jobs left unassigned or unacknowledged.

**Phase 2 — handoff and paste:** build paste review, source-specific rules, technician acceptance, timestamps, and automatic board refresh. Success signals: high reviewed-field accuracy, lower time to assignment, faster acceptance, and fewer phone calls asking for job status.

**Phase 3 — economics and follow-up:** source fees and balances, source margin report, estimates, and scheduled agenda. Success signals: every partner job has a reconciled source fee, accurate job margin, quote conversion tracked, and fewer overdue appointments.

**Later:** map, parts stock ledger, settlement-file import, multi-location, automated communications, and AI receptionist only when usage and data justify their maintenance cost.

## Evidence and caveats

Directly inspected signed-in pages: [Dispatch](https://cleartheq.com/), [Jobs](https://cleartheq.com/jobs), [Clients](https://cleartheq.com/clients), [Sources](https://cleartheq.com/sources), [Reports](https://cleartheq.com/reports), [Settings](https://cleartheq.com/settings), [Invoices](https://cleartheq.com/invoices), [Inventory](https://cleartheq.com/inventory), [Import](https://cleartheq.com/import), and related navigation screens. Public positioning: [Clear the Q homepage](https://cleartheq.com/). Our comparison is based on the current repository's Prisma schema, dispatch/technician/owner pages, Books module, and README. Because the trial account was empty, capabilities shown only as controls are described as UI offerings rather than proven end-to-end behavior.
