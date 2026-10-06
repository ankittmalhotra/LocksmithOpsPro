# RingCentral Call-to-Job Matching and Call Analytics

## Objective

Link RingCentral calls to jobs, show the provider's exact received time on linked jobs, and provide a separate Call Analytics page. Historical links use a conservative one-to-one auto-match; dispatchers select the call during new job intake. The Admin dashboard keeps only a compact call-demand and ad-timing summary.

## Current system and data evidence

- `Job` stores `createdAt`, `completedAt`, `customerId`, and customer phone, but no call foreign key or exact received-call time. `jobReceivedTimeSlot` is a coarse text field. See `prisma/schema.prisma:162-236`.
- `RingCentralCallLog` stores exact `startTime`, caller/destination fields, direction, duration, result, voicemail state, and provider payload. See `prisma/schema.prisma:412-463`.
- RingCentral cache refresh is idempotent on `sourceKey` and currently fetches inbound, outbound, and voicemail logs. See `src/lib/ringcentral-call-cache.ts:238-321`.
- Existing analytics groups calls by Toronto day, recognizes callback-recovered missed calls, and separates short calls, voicemail, and missed calls. See `src/lib/ringcentral-analytics.ts:94-156` and `src/lib/ringcentral.ts:657-750`.
- Current conversion chart counts every job created on a date as converted; it does not link jobs to calls. See `src/lib/ringcentral-analytics.ts:212-217`. Keep that legacy series clearly labeled or replace it; never present it as linked conversion.
- Standard job intake is `src/app/api/jobs/route.ts:71-214`; manual historical intake is `src/app/api/jobs/manual/route.ts:24-33,139-168`. Manual dates may be stored at Toronto midnight and are not actual call times.
- Admin is `src/app/owner/page.tsx`. It shows RingCentral and Google Ads panels at `:741-743+` and syncs Ads on dashboard load at `:206-260`. The RingCentral API allows Admin and Dispatcher; Ads routes require Admin (`src/app/api/owner/analytics/route.ts:22-34`, `src/app/api/owner/google-ads/sync/route.ts:17-25`).
- Google Ads persistence and fetch are daily account totals only (`prisma/schema.prisma:367-383`, `src/lib/google-ads.ts:255-323`). Existing totals cannot identify the hour or campaign that caused a call.
- A server-side Gemini request pattern exists in `src/lib/gemini-receipt.ts:128-175`. Use a separate insights module.

### Baseline to recheck before implementation

A prior read-only production check found 46 completed jobs, 225 qualifying inbound sessions (220 answered at least 30 seconds and five missed sessions with a successful callback), and 190 known caller-day lead rows. Exact-phone/time comparison found seven job/lead candidates within 24 hours, five on the same Toronto day. Phone-only overlap appeared on 43 of 46 jobs, which is not proof of conversion. These are stale candidate counts, not persisted or reviewed matches; recalculate them and the actual four-week coverage at implementation time.

The cache observed in that check covered August 18–October 5, 2026. Verify day-by-day coverage before calling the latest four weeks complete.

## V1 product definitions and decisions

### Calls and leads

- A **call session** is one inbound RingCentral session. It measures operational call volume.
- A **known caller-day lead** is one known canonical caller counted once per Toronto calendar day under existing grouping rules. It approximates unique daily demand and is the heatmap's primary measure.
- **Unknown caller sessions** remain separate because callers cannot be deduplicated reliably. Do not imply they represent unique people.
- Reuse current qualification rules: answered inbound calls lasting at least 30 seconds qualify; missed inbound calls count as received leads only when existing logic finds a successful callback. Uncalled missed calls, voicemail, and brief calls remain separate activity categories. Show these categories and the rule near the chart.

### Phone matching and job links

- The current `normalizeRingCentralPhone` strips non-digits and truncates numbers longer than ten digits to the last ten (`src/lib/ringcentral-call-cache-utils.ts:3-6`). That is not a safe exact international key. Add a shared canonicalizer that preserves country code and consistently handles ten-digit NANP and explicit `+1`; represent valid numbers in E.164-style form when possible. Do not auto-suggest invalid, short, shared, or ambiguous numbers as exact matches.
- Decide how to compare legacy cache rows whose normalized value lost country code; do not silently treat their truncated value as globally unique. Never match identity on last five digits.
- Add an auditable `JobCallMatch` association with job ID, call-log ID, status (`SUGGESTED`, `CONFIRMED`, `REJECTED`), method, role (`ORIGINATING_INBOUND`, `FOLLOW_UP`), rationale, reviewer/time, and immutable reviewer name/role snapshots so user deletion does not erase attribution. Enforce unique job/call pairs and at most one confirmed originating inbound call per job. Multiple follow-up calls are allowed.
- V1 never links by phone alone. After the dispatcher enters a valid phone, show qualified inbound call sessions from the preceding 72 hours whose canonical caller number exactly matches. The dispatcher must explicitly choose a listed session to link it; do not preselect one or auto-confirm from a unique phone/time heuristic. Saving without a link remains allowed. Show a linked call's exact provider `startTime` in Toronto time; never copy a guessed time onto the job.
- `Job.createdAt` is record-entry time, not guaranteed intake time. Do not use it to expand the three-day candidate window or invent matches. A manual job date at midnight is not call-time evidence. Do not require a RingCentral round trip for job creation.
- Put Call Analytics in its own navigation item and remove the large analytics panel from Dispatch and Admin pages. Default the heatmap to completed jobs, with a switch to received calls. For manually entered completed jobs, use the stored two-hour received-time window as the hour bucket and omit records with no reliable hour. Explain this approximation in the chart.
- In standard dispatch intake, use the exact canonical caller number entered in the phone field to list each qualified inbound session from the previous 72 hours. Dispatchers explicitly select a session to link; no result, an invalid number, or no selection must never block job save. Historical ambiguity remains unlinked without asking an Admin to resolve it.

### Call demand and Ads

- Calculate all counts, time buckets, date ranges, recurrence flags, and coverage on the server. Show only the strongest repeat weekday/hour window and a simple ad-coverage suggestion.
- V1 heatmap covers four complete weeks in `America/Toronto`, separately indexing each day-of-week and hour. For example, Monday 9–10 a.m. and Sunday 9–10 a.m. are different cells. Do not pool weekdays/weekends or morning/evening.
- A recurring cell requires verified call coverage in at least three of the four weeks and a named minimum pooled caller-day lead count. Show each week's count in the cell detail; no recommendation for cells below threshold. Display exact weeks and label incomplete coverage.
- Four weeks are exploratory evidence, not seasonality. Ads demand correlation is not campaign attribution. Tell Admins to compare call timing with Google Ads results before changing spend; existing daily Ads totals cannot identify winning campaigns by hour.

## Phase 0 — Definitions and source/coverage audit

### Work

- Map all job create/edit paths, call sync/read endpoints, Toronto date helpers, and authorization rules.
- Reconcile four complete weeks of call coverage by date: sessions by activity kind, known caller-day leads, unknown caller sessions, sync freshness, and gaps. Recompute job/call candidates as suggestions only.
- Document the canonical phone format and migration/compatibility behavior for legacy ten-digit cache values.
- Confirm Google Ads customer timezone for any daily context; do not add granular Ads queries in V1.

### Guards

- Missing cached rows are not zero demand unless sync proves coverage.
- Neither job creation date nor manual job date supplies exact call time.
- Same-phone overlap alone is not conversion evidence.

## Phase 1 — Persistent links and exact-time display

### Work

- Add the migration and Prisma relationship, indexes, foreign keys, unique pair constraint, and partial uniqueness for one confirmed originating call per job and per call. Preserve link/review history in durable deletion audit snapshots for every job deletion path; never delete source call records as a side effect.
- Add confirmed-call display to job detail: received date/time in Toronto, masked caller detail as appropriate, and follow-up touches separately. Existing jobs without links render normally.
- Auto-link historical jobs only when the exact phone and qualifying tracked inbound call form a unique job/call pair on the same Toronto day. Preserve the exact RingCentral call time on the link. Leave multiple candidates, phone collisions, stale phones, or unsupported call outcomes unlinked.

### Verification

- Verify migrations on empty and populated databases, duplicate prevention, one-originating-call rule, and DST formatting.
- Verify the displayed exact time is read from the linked call row's `startTime`.

## Phase 2 — Dispatcher selection and historical auto-linking

### Work

- Implement a pure candidate service that canonicalizes the entered caller number and returns every qualified inbound call session from the previous 72 hours with an exact canonical-number match. Do not match by phone alone without an explicit user choice, do not auto-select a sole result, and do not use `createdAt` to expand or invent matches.
- In standard dispatcher intake, show matching sessions with exact call time, kind, and duration. Require an explicit selected call ID to create a link, and revalidate phone, direction, qualification, three-day window, existing link conflicts, and dispatcher role server-side in the job/link transaction.
- Historical matching uses existing RingCentral history directly and confirms only unique exact-phone, qualifying, same-day job/call pairs. Keep ambiguous candidates unlinked; do not show an Admin review queue.
- Historical matching uses the saved candidate records and confirms a unique one-to-one exact-phone, qualifying, same-day pair. Ambiguous or conflicting suggestions remain unlinked and are not presented for Admin review. Do not accept a free-form timestamp as provider evidence.
- Recompute suggestions when customer phone changes, without overwriting a confirmed/reviewed link silently. Reject any attempt to confirm an originating call unless its RingCentral direction is inbound and it satisfies the shared inbound qualification rule (30+ second answered call, or a missed inbound lead recovered by a successful callback); voicemail, brief calls, uncalled missed calls, and outbound calls cannot be confirmed as originating calls.

### Verification

- Cover canonical NANP variants, country code preservation, invalid/international/unknown numbers, shared/reused callers, duplicate jobs, multiple calls, callbacks, voicemail, missed/short calls, and Toronto day boundaries.
- Route validation covers unauthorized users, forged call IDs, wrong phone/direction/qualification, calls outside the 72-hour window, already-linked calls, explicit no-selection, invalid caller numbers, and transaction rollback. Explicitly verify that a confirmed originating call must be inbound and pass the same qualification predicate used by call analytics.
- Job creation remains available during RingCentral failure/cache delay. No match, invalid number, or no selection saves an unlinked job. Candidate results and audited review actions affect only the selected job/call.

## Phase 3 — Deterministic four-week demand dashboard and visual

### Work

- Add a server aggregation endpoint/service for caller-day leads, completed jobs, coverage, and freshness.
- Design a visual-first, readable Toronto day-of-week × hour heatmap for four complete weeks. Every weekday/hour pair is its own cell. Use a stable Monday–Sunday order and Toronto-local hour labels.
- Default the heatmap to completed jobs and provide a switch to received calls. Manual jobs use their recorded two-hour received-time window for the hour bucket; records without a reliable hour are omitted and counted separately. Each cell's focus or click reveals all four weekly counts.
- Add a clear legend for lead-count intensity, “insufficient data”, and recurring status. Show the sample count/threshold, date range, sync freshness, and coverage indicator above the chart. Explain sessions vs caller-day leads in concise help text.
- Provide separate Day, Day & Hour, and Hour views without merging the default weekday/hour cells. Mark a cell recurring only with verified coverage in at least three of four weeks and at least the displayed minimum pooled lead count. Make threshold a named constant and keep it visible. Do not convert uncovered week/cell into zero.
- Keep the chart concise and label counts clearly. Calls and jobs are separate activity series, not campaign attribution.

### Verification

- Test four complete week boundaries, leap/day rollover if applicable, Toronto DST transitions, day/hour cell identity (e.g. Monday 9–10 ≠ Sunday 9–10), per-week counts, repeat caller-day grouping, unknown sessions, recurring threshold, and missing coverage.
- Reconcile displayed totals and a sample of cells back to source records. Validate accessible non-color labels and keyboard detail access.

## Phase 4 — Compact Admin call-demand summary

### Work

- Add an Admin-only summary showing the strongest repeated weekday/hour call window, data coverage, and one ad-coverage recommendation. Keep Ads data Admin-only and do not imply campaign attribution.
- Show only the strongest repeated weekday/hour call window, coverage, and one practical ad-coverage suggestion. Tell Admins to compare this pattern with Google Ads results before changing spend; do not claim campaign attribution.

### Verification

- Reject Dispatcher, Technician, Accountant, and unauthenticated access.
- Visually verify the busy-window evidence, Toronto day/hour labels, coverage, and insufficient-data state.

## Phase 5 — Daily Ads context and later validation gates

### V1 scope

- Keep existing daily account totals. Display them only as separate daily context if customer timezone alignment is verified. Handle absent/stale Ads data without breaking call insights.
- Do not add campaign/hour Ads storage or compare hourly campaign delivery to calls in V1. Current code is daily account-level only (`prisma/schema.prisma:367-383`, `src/lib/google-ads.ts:255-323`).

### Later scope gate

- Before granular Ads work, verify Google Ads API v25 query compatibility against the chosen resource, account timezone, data availability, and a read-only sample query. Reconcile granular daily sums against existing totals before release. Only then consider campaign/day/hour storage and adequate sample thresholds.
- Evaluate direct call attribution (tracking numbers, supported Ads call reporting, or click IDs) as a separately reviewed design that covers privacy, customer consent, dispatcher workflow, and attribution accuracy. No v1 UI may imply campaign attribution without such evidence.

## Phase 6 — Pilot, success metrics, and expansion

### V1 success metrics and release gates

- **Coverage:** four-week pattern recommendations require at least 24 of 28 days with verified RingCentral coverage. Otherwise show available data and “insufficient coverage”; do not label recurring demand.
- **Metric integrity:** every count/rate reconciles to source data and shows its definition and denominator. Sessions, caller-day leads, confirmed links, and suggestions remain distinct.
- **Link quality:** Confirm only unique exact-phone, qualifying, same-day candidate pairs. Preserve ambiguous or conflicting pairs as unlinked.
- **Recommendation integrity:** Call demand guides timing and staffing only. Daily Ads results remain the basis for spend decisions; do not claim hourly campaign performance.
- **Operational safety:** jobs save when RingCentral is unavailable; unauthorized roles cannot read Admin Insights; link actions are auditable and reversible.
- **Decision usefulness:** after 8–12 weeks of verified coverage, run one controlled ad-schedule or staffing experiment at a time. Compare qualified caller-day leads, confirmed completed jobs, and cost per confirmed completed job only where spend period/timezone is valid. Keep an unchanged comparison period when feasible.

### Rollout

- Pilot historical auto-links and dispatcher intake selection. Maintain weekly snapshots of metric inputs, definitions/version, coverage, and data watermark.
- Reconsider granular Ads ingestion only after Phase 5 validation. Reconsider direct attribution only after a separate design review.
- Four weeks can reveal repeated operational demand, but cannot establish seasonality or prove Ads causation. No automatic campaign edits.

## V1 implementation order

1. Audit source routes, four-week coverage, metric definitions, timezone, and phone canonicalization/legacy compatibility.
2. Add auditable job/call links and exact linked call time.
3. Add dispatcher call selection for new jobs and automatically confirm only unique, high-confidence historical pairs; leave ambiguous history unlinked.
4. Build deterministic session/lead/link metrics and the four-complete-week Toronto weekday × hour heatmap with week detail, legend, thresholds, coverage, and accessible non-color labels.
5. Add a separate Call Analytics menu item, default its heatmap to completed jobs, and keep the Admin demand/ad-timing summary concise.
6. Show existing daily Ads context only when aligned; defer campaign/hour ingestion and direct attribution behind their validation gates.
