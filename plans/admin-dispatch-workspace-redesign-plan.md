# Admin and Dispatcher workspace redesign

Updated October 7, 2026 · Condensed after implementation review. Supersedes the earlier 500-line draft (kept in git history).

**Goal:** Admin and Dispatcher use one operational workspace with one menu order. Admin gets extra capabilities (Google Ads, staff, cash settlement) on top. Dashboard summarises; each detail lives on one page. Business reporting stays separate from ad attribution.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Shared shell, six-item menu, New job / Jobs utilities, route gates | **Done** |
| 2 | Dashboard, shared reporting service, operations report + CSV, Admin Team and Cash ledger pages | **Done** |
| 3 | Books split into Overview / Expenses / Reimbursements / Billing / Reports; Dashboard Books attention card | **Done** (task routes mount the existing controlled forms by view; `/books/legacy` redirects) |
| 4 | Call Analytics sections, "Jobs logged" relabel, cohort-aligned linked conversion, Dashboard Call Activity | **Done** |
| 5 | Active-job Live Map and Calendar upgrades, Dashboard Map/Calendar previews | **Deferred** (existing pages stay as they are; no previews) |
| 6 | Google Ads: account overview from cache, honest labels, `/owner` retired | **Overview done.** Campaign and breakdown reporting **dropped** until an Admin shows a decision it would change |
| 7 | Verification and docs | Smoke script and README/DEPLOYMENT updated. Feature flags and instrumentation **dropped** |

Dashboard is intentionally **without** Live Map and Calendar previews while Phase 5 is deferred.

## Product contract

### Menu (same order on desktop, collapsed sidebar and mobile drawer)

| # | Menu | Admin | Dispatcher | Route |
|---|---|---|---|---|
| 1 | Dashboard | Yes | Yes | `/dashboard` |
| 2 | Call Analytics | Yes | Yes | `/dispatch/call-analytics` |
| 3 | Books | Authorised entities | Locksmith only | `/books` |
| 4 | Live Map | Yes | Yes | `/dispatch/map` |
| 5 | Calendar | Yes | Yes | `/dispatch/calendar` |
| 6 | Google Ads | Yes | Hidden, server-denied | `/google-ads` |

**New job** (Assigned / Unassigned / Completed) and **Jobs** (`/dispatch`) are persistent sidebar actions. `/dispatch?addJob=1` keeps opening completed entry. Admin tools: `/admin/team`, `/admin/cash-ledger`. `/owner` redirects to `/dashboard`, or to `/google-ads` when returning from Google OAuth. Admin and Dispatcher both land on `/dashboard`. Admin can still enter a restricted Dispatcher preview session with a visible return control; never grant Ads based on `originalRole`.

### Permissions to preserve

| Capability | Admin | Dispatcher |
|---|---|---|
| Dashboard, Call Analytics, jobs, map, calendar | Yes | Yes |
| Technician management | Yes | Technicians only |
| Admin / Dispatcher / Accountant accounts | Yes | No |
| Google Ads data, sync, OAuth, exports | Yes | No |
| RingCentral connection management | Yes | No |
| Locksmith Books | Yes | Membership/capability scoped |
| IT & Marketing Books | Yes | No |
| Accounting mapping, invoice issue, payment marking, repayment reversal, cash settlement | Yes | No |

Authorise on the server (effective role plus Books entity membership) for pages, APIs and exports. Navigation is not an authorisation boundary. Do not return restricted fields and filter them in React.

### Dashboard

Bounded summaries with a link to the detail page. Each card has its own loading, empty, stale and error state; a provider outage never blocks the rest.

| Card | Content | Detail |
|---|---|---|
| Financial period | Paid gross revenue, HST, COGS, commissions, contribution. Default: current biweekly. | Books → Reports → Operations report, same dates |
| Last 7 Days | Paid revenue by Toronto day, completed jobs, average ticket. Today marked partial. | Same report |
| Call Activity | Today's qualifying leads and unresolved missed inbound sessions, with coverage. | Call Analytics, Activity, unresolved |
| Books needs attention | Locksmith only; cumulative open items; zero items are hidden (see below). | Relevant Books page |
| Google Ads (Admin) | Cached spend and whole-business comparison | Google Ads |
| Recent activity | Latest 10 jobs by entered date | Jobs desk |

**Books needs attention rules** (decided, not left to the user):
- Shows only non-zero rows: *expenses missing a receipt*, *personal expenses needing payer or payment date*, *amount to repay*. If all are zero: "All caught up."
- "Unconfirmed" means a personal-paid expense with an open balance and no payer name or no payment date. These are a to-do for the person entering data, so they are counted separately and are **never** included in "to repay". "To repay" is confirmed open balance only (matches the Reimbursements page: `owedCents`).
- Always the Locksmith entity and cumulative (not period totals). Hidden when the viewer has no Locksmith Books access.

### Call Analytics

Sections: Overview, Activity, Demand Patterns, Linked Jobs, URL-backed. Reads the Prisma call cache only.
- *Jobs logged* = every job logged in the period, whether or not tied to a call. Its ratio to leads can exceed 100% and is not conversion.
- *Linked conversion* = distinct inbound sessions in the range with a confirmed originating job link ÷ eligible inbound sessions in the same range, with the observation cutoff shown.
- Missing coverage is "unavailable", never zero. No phone-only attribution.

### Books

| Page | Contents |
|---|---|
| Overview | Current-period expense and invoice summary, recent invoices (read-only, never creates snapshots) |
| Expenses | Expense register, receipt filter (`?receipt=missing`), add/edit/remove, OCR receipt review; IT & Marketing Admin also sees cached Google Ads spend (read-only, not an expense) |
| Reimbursements | Outstanding by person, repayment, history, mapping queue, Admin-only reversal |
| Billing | Biweekly periods, issued invoices, partner invoice issue/payment |
| Reports | Operations report, reimbursement CSV, mapping queue link |

Rules: Locksmith for Dispatcher; stable entity codes; issued snapshots never recalculate; a personal-funded expense is recorded once and repayment settles it; synthetic Ads rows are never counted as imported expenses. Billing is the only view that reads periods (which can materialise snapshots).

Implementation note: the task routes mount `LegacyBooksWorkspace` with a `view` prop and `embedded` flag. Each view loads and renders only its own sections. Further splitting into smaller components is optional cleanup, not a release requirement.

### Google Ads (Admin)

Account overview from the cached daily table: spend, clicks, impressions, CTR, average CPC, Google-reported conversion value, daily spend, prior equal-length period, sync status and coverage, Sync and Reconnect. Currency and time zone must be verified through environment configuration (`GOOGLE_ADS_METADATA_VERIFIED=true`); until then no spend is shown.

Labels: *Business contribution after ad spend* is whole-business, not Ads profit. "ROAS" is not used for contribution ÷ spend. Attributed ROI is shown as unavailable because there is no verified job-to-campaign link. Do not distribute unattributed jobs across campaigns.

Not planned: campaign, keyword, device, geography breakdowns. Revisit only when the Admin names a spend decision they would make from them.

### Live Map and Calendar (deferred)

Unchanged. When revisited: default the map to active jobs with visible freshness; keep technician GPS, ETA and route optimisation out of scope; remove Ads return from Calendar and scope its legacy Ads read by customer account.

## Technology rules

- One typed menu definition; server gates in middleware plus handler checks.
- Shared reporting functions back the Dashboard, report and export so they reconcile to the cent. Use Toronto date helpers for any day boundary.
- Dashboard reads use database caches; no synchronous provider sync.
- Reads are bounded and ordered with stable tie-breakers; exports are complete.
- Ads sync fetches days with bounded concurrency (five at a time).

## Verification

Run the relevant standalone scripts (`node --experimental-strip-types tests/<name>.test.ts`): `operations-reporting`, `dashboard-report-routes`, `ringcentral-analytics`, `ringcentral-demand`, `google-ads`, `books-window`, accounting tests, plus `workspace-smoke` against a running server (`SMOKE_*` env vars add Admin and Dispatcher checks). `npm run build` before release.

Manual checks per release: menu order and active states for Admin and Dispatcher; Dispatcher denied on Ads page, APIs and OAuth; New job from every main page; Books task flows (expense with receipt, repayment, invoice) in both entities; Dashboard card ↔ detail page dates match.

Rollback: roll back UI and redirects without reverting financial writes or deleting history. Apply additive SQL before code that reads it.

## Open items

1. Verify `GOOGLE_ADS_METADATA_VERIFIED` and related variables in production, then check the Google Ads page against the Google Ads UI for one week.
2. `/api/owner/analytics` has no UI consumer now and still returns `companyRoas` / `partnerRoas` with the old contribution ÷ spend meaning. Remove or rename when convenient.
3. Phase 5 when wanted. Optional: split the embedded Books workspace into smaller components.
