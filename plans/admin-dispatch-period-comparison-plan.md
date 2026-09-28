# Admin and Dispatch Period Comparison Widget — Implementation Plan

## 1. Product outcome

Add a compact comparison widget to the Admin and Dispatch dashboards. A selector switches between:

- **Week to date vs same days last week:** Monday through today compared with the same Monday-through-weekday range one week earlier. For example, on Wednesday compare Monday–Wednesday in both weeks.
- **Biweekly to date vs same days previous period:** the current anchored 14-day period from its first day through today compared with the same number of elapsed days in the immediately previous 14-day period.

Show gross revenue and completed-job count for both ranges, the absolute change, and percentage change. Put the exact date span beside each side so the comparison is easy to interpret. Use a clear placeholder for percent change when the prior value is zero.

For comparable and consistent metrics, revenue means the gross total of paid invoices, assigned to the Toronto-local payment date (`paidAt`, with the existing fallback behavior where needed). Completed jobs means jobs with `status === 'COMPLETED'`, assigned to `completedAt`. These are deliberately separate date/eligibility rules: a completed but unpaid job contributes to job count but not paid revenue.

## 2. Documentation and codebase discovery

### Sources consulted

- `src/app/owner/page.tsx:177-209` — Admin dashboard analytics fetch and query parameter pattern; `:475-491` — labeled controlled period dropdown; `:583-674` — summary panel and accessible CSS bar chart style.
- `src/app/dispatch/page.tsx:254-290` — Dispatch job fetch; `:631-681` — current paid-invoice financial summary; `:717-731` — controlled dropdown pattern.
- `src/app/api/owner/analytics/route.ts:22-38` — Admin authorization and analytics request handling; `:61-89` and `:167-187` — paid-invoice revenue and Toronto-local date-series conventions.
- `src/app/api/jobs/route.ts:16-58` — Admin/Dispatcher access to jobs; `src/lib/job-helper.ts:96-107` — shared job-details query helper.
- `src/lib/revenue-period.ts:24-67` — date bounds, revenue activity date, and Toronto date filtering.
- `src/lib/accounting.ts:3-5,98-106` — 14-day billing period anchor and `getPartnerBillingPeriod(date, anchor?)`.
- `src/lib/timezone.ts:1-12,67-83` — `formatTorontoDateInput(value?)` and Toronto date parsing helpers.
- `prisma/schema.prisma:88-108,210-218,243-272` — `JobStatus`, `PaymentStatus`, `Job.completedAt`, invoice totals, and invoice `paidAt`.
- `package.json:1-26` — Next.js App Router, React, TypeScript, Tailwind, and no chart package.
- `tests/revenue-period.test.ts:8-40` — existing injected-date tests for date-boundary behavior.

### Allowed implementation patterns

- Reuse `getPartnerBillingPeriod`, `formatTorontoDateInput`, and the existing `findJobsWithDetails` helper instead of introducing a second business-timezone or job-loading convention.
- Add a small authenticated aggregate route for this widget, restricted to `ADMIN` and `DISPATCHER`. Keep the response limited to the two comparison windows and their revenue/job-count values; do not broaden `/api/owner/analytics`, which returns admin-only team and financial data.
- Reuse the native `<select>` plus controlled React state and Tailwind panel patterns already used in both dashboards.
- Add the widget to `src/app/owner/page.tsx` and `src/app/dispatch/page.tsx`; the Dispatch view should only render it for Admin/Dispatcher users.
- Keep charts optional: the widget can communicate the comparison with paired metric cards and change indicators, using the existing CSS patterns if a visual bar is useful.

### Anti-patterns to avoid

- Do not count every `COMPLETED` job as paid revenue; require a `PAID` invoice for revenue.
- Do not count paid invoices as the only completed jobs; use completion status/date for the completed-work count, including unpaid completed work.
- Do not compare a partial current week or biweekly period against a full previous period. The ranges must have matching elapsed days.
- Do not use the browser/server machine's local timezone for business-date boundaries; use Toronto date keys and date-only arithmetic.
- Do not expose Admin-only analytics through a route accessible to Dispatchers.
- Do not add a chart dependency for this compact widget.

## 3. Phased implementation

### Phase 1 — Shared comparison-window and aggregation rules

**What to implement**

- Add shared types and helpers for the `week` and `biweekly` comparison modes, date-key bounds, date labels, and metric aggregation.
- Calculate Monday-to-today for the current week and the matching Monday-to-weekday range from the prior week.
- Use `getPartnerBillingPeriod` for the current and previous 14-day periods. Shorten the previous-period range to the same elapsed number of days as the current period.
- Aggregate paid gross revenue using `invoice.grandTotal` and the Toronto-local `paidAt` date. Aggregate completed-job count using `status === 'COMPLETED'` and the Toronto-local `completedAt` date.
- Make date arithmetic operate on ISO date keys in UTC so daylight-saving transitions do not shift a calendar day.

**Documentation references**

- Copy the date-key and Toronto timezone approach from `src/lib/revenue-period.ts:24-67` and `src/lib/timezone.ts:67-83`.
- Copy the anchored 14-day lookup from `src/lib/accounting.ts:98-106`.
- Follow job and invoice field definitions in `prisma/schema.prisma:88-108,210-218,243-272`.

**Verification checklist**

- Verify Monday and Wednesday examples, Sunday week boundary, first day of a biweekly period, and the final day of a biweekly period.
- Verify each prior comparison window has the same number of days as its current window.
- Verify Toronto-local dates remain correct across daylight-saving changes.
- Verify unpaid completed jobs affect only completed-job count, while paid invoices affect revenue by payment date.
- Add focused date/aggregation unit tests during implementation, following `tests/revenue-period.test.ts:8-40`.

**Anti-pattern guards**

- Avoid `Date.setDate()` in machine-local time for business-date arithmetic.
- Avoid using `createdAt` as the completion date or treating status `INVOICED` as completed without confirming the existing workflow definition.

### Phase 2 — Narrow comparison API

**What to implement**

- Add a GET endpoint (proposed: `src/app/api/analytics/period-comparison/route.ts`) that authenticates the current user and permits only `ADMIN` and `DISPATCHER`.
- Return both comparison modes in one compact response, with current/prior range start and end labels, revenue, completed-job count, absolute deltas, and percentage deltas (or enough values for the client to derive those safely).
- Load the job/invoice fields through `findJobsWithDetails`; aggregate only records that fall within at least one requested comparison window.
- Validate and handle absent dates/invoices safely. Return stable zero values for empty windows.

**Documentation references**

- Copy the role-check structure from `src/app/api/owner/analytics/route.ts:22-30` and the allowed Admin/Dispatcher roles from `src/app/api/jobs/route.ts:16-58`.
- Reuse `findJobsWithDetails` from `src/lib/job-helper.ts:96-107`.
- Follow existing JSON response/error handling from `src/app/api/owner/analytics/route.ts`.

**Verification checklist**

- Confirm unauthenticated and unauthorized roles receive an error response, while Admin and Dispatcher receive only comparison data.
- Confirm values and range labels match the shared date helper output.
- Confirm zero prior values never produce `Infinity` or `NaN` percentage changes.

**Anti-pattern guards**

- Do not return technician ledger, recent jobs, or other Admin analytics from this endpoint.
- Avoid separate, subtly different aggregation implementations in the Admin and Dispatch clients.

### Phase 3 — Admin and Dispatch dashboard widget

**What to implement**

- Add the comparison selector with the two clearly labeled options and default to week-to-date vs. last week.
- Fetch the comparison data when each dashboard loads; switching options should switch the displayed windows without changing the existing financial-period selector or Google Ads selector.
- Add a responsive widget showing current and comparison date spans, gross revenue, completed jobs, absolute changes, and percent changes.
- Render the widget in the Admin dashboard and for Admin/Dispatcher users on Dispatch. Provide loading, error, and empty-data states consistent with current dashboard patterns.
- Make labels explicit that revenue is paid gross revenue and job counts are completed jobs.

**Documentation references**

- Copy the dropdown state and markup pattern from `src/app/owner/page.tsx:475-491` and `src/app/dispatch/page.tsx:717-731`.
- Copy Admin fetch lifecycle patterns from `src/app/owner/page.tsx:177-209` and Dispatch job-fetch lifecycle patterns from `src/app/dispatch/page.tsx:254-290`.
- Reuse the summary-panel and responsive Tailwind patterns from `src/app/owner/page.tsx:583-674`.

**Verification checklist**

- Confirm both dashboards show the same values and date spans for the same selected mode.
- Confirm selector switching does not alter existing revenue-period/Google Ads behavior.
- Confirm the Dispatch widget is hidden for Technician users and remains available to Admin/Dispatcher users.
- Check narrow/mobile layout, accessible select labels, loading state, empty periods, and zero-baseline change display.

**Anti-pattern guards**

- Do not reuse the current financial period dropdown as the comparison selector; the meanings differ.
- Do not place raw job records in client state solely to compute these summary metrics.

### Phase 4 — Final verification

**What to verify**

- Review the date helper, API authorization, aggregation semantics, and both dashboard integrations against the sources above.
- Run the focused date/aggregation tests and the repository's available static/build checks after implementation.
- Manually inspect both dashboard modes, comparing current/prior labels and values with known sample records around week, biweekly, and Toronto timezone boundaries.
- Check that the API response contains no unrelated financial, team, or customer details.

**Anti-pattern guards**

- Do not accept a passing UI check if the job count and paid-revenue date rules differ from the documented definitions.
- Do not add tests or build tooling beyond the repository's existing stack.

## 4. Product decision — resolved

Use **Week to date vs same days last week** and **Biweekly to date vs same days previous period**. Both comparisons use equal-length windows ending on the same weekday/elapsed day, so recent performance is compared fairly without letting the longer, completed prior period inflate the result. Keep the metric dates explicit: paid gross revenue is grouped by payment date, while completed jobs are grouped by completion date. This matches the user's same-days example and applies the same like-for-like rule to both selectable periods.
