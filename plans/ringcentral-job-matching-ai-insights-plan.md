# RingCentral Call-to-Job Matching and Admin AI Insights

## Objective

Link selected RingCentral calls to jobs, show the provider's exact received time on linked jobs, and build an Admin-only Insights section that helps plan staffing and advertising from four weeks of call-demand data. V1 uses suggestions and human confirmation for links. It does not claim campaign attribution or automatically change advertising.

This is an implementation plan. No application code or production data has been changed by this plan revision.

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
- In standard dispatch intake, use the exact canonical caller number entered in the phone field to list each qualified inbound session from the previous 72 hours. Dispatchers explicitly select a session to link; no result, an invalid number, or no selection must never block job save. Admins handle historical candidate review and can confirm/reject/unlink links. Keep Ads data and AI Insights Admin-only.

### Insights and Ads

- Calculate all counts, rates, time buckets, denominators, date ranges, recurrence flags, and coverage on the server. Gemini receives minimized aggregate metrics only; it cannot calculate source values, establish a match, or claim campaign attribution.
- V1 heatmap covers four complete weeks in `America/Toronto`, separately indexing each day-of-week and hour. For example, Monday 9–10 a.m. and Sunday 9–10 a.m. are different cells. Do not pool weekdays/weekends or morning/evening.
- A recurring cell requires verified call coverage in at least three of the four weeks and a named minimum pooled caller-day lead count. Show each week's count in the cell detail; no recommendation for cells below threshold. Display exact weeks and label incomplete coverage.
- Four weeks are exploratory evidence, not seasonality. Ads demand correlation is not campaign attribution. Existing daily Ads totals may appear as separate, timezone-labeled context only when date alignment is validated. Defer campaign/hour ingestion and direct call-source attribution to later phases behind validation and privacy gates.

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
- Add Admin review surface for historical suggestions and link history, including rationale, who confirmed it, and when.

### Verification

- Verify migrations on empty and populated databases, duplicate prevention, one-originating-call rule, and DST formatting.
- Verify the displayed exact time is read from the linked call row's `startTime`.

## Phase 2 — Candidate selection, review, and historical suggestions

### Work

- Implement a pure candidate service that canonicalizes the entered caller number and returns every qualified inbound call session from the previous 72 hours with an exact canonical-number match. Do not match by phone alone without an explicit user choice, do not auto-select a sole result, and do not use `createdAt` to expand or invent matches.
- In standard dispatcher intake, show matching sessions with exact call time, kind, and duration. Require an explicit selected call ID to create a link, and revalidate phone, direction, qualification, three-day window, existing link conflicts, and dispatcher role server-side in the job/link transaction.
- Add an Admin-only historical review queue with explicit candidate generation and confirm/reject actions. Queue GET reads persisted suggestions only; generation is bounded and does not auto-confirm. Store the canonical phone used to suggest a link, snapshot reviewer name/role, and flag matches as stale when the current customer phone changes.
- Manual historical intake may use a separate optional call picker or Admin review queue; do not restrict historical review to the three-day intake window. Do not accept a free-form timestamp as provider evidence. Save jobs normally if no candidate exists or RingCentral is unavailable.
- Recompute suggestions when customer phone changes, without overwriting a confirmed/reviewed link silently. Reject any attempt to confirm an originating call unless its RingCentral direction is inbound and it satisfies the shared inbound qualification rule (30+ second answered call, or a missed inbound lead recovered by a successful callback); voicemail, brief calls, uncalled missed calls, and outbound calls cannot be confirmed as originating calls.

### Verification

- Cover canonical NANP variants, country code preservation, invalid/international/unknown numbers, shared/reused callers, duplicate jobs, multiple calls, callbacks, voicemail, missed/short calls, and Toronto day boundaries.
- Route validation covers unauthorized users, forged call IDs, wrong phone/direction/qualification, calls outside the 72-hour window, already-linked calls, explicit no-selection, invalid caller numbers, and transaction rollback. Explicitly verify that a confirmed originating call must be inbound and pass the same qualification predicate used by call analytics.
- Job creation remains available during RingCentral failure/cache delay. No match, invalid number, or no selection saves an unlinked job. Candidate results and audited review actions affect only the selected job/call.

## Phase 3 — Deterministic four-week demand dashboard and visual

### Work

- Add a server aggregation endpoint/service that supplies: inbound call sessions; qualified sessions; known caller-day leads; unknown caller sessions; short, voicemail, uncalled missed, and callback-recovered counts; confirmed originating links; suggested links; confirmed completed jobs; coverage and freshness.
- Design a visual-first, readable Toronto day-of-week × hour heatmap for four complete weeks. Every weekday/hour pair is its own cell. Use a stable Monday–Sunday order and Toronto-local hour labels.
- Each cell displays a pooled count or intensity for known caller-day leads. Hover, keyboard focus, or click reveals all four week counts, verified coverage per week, total sessions, and linked/suggested job counts. Provide an accessible table/list view with the same labels and values; color must not be the only encoding.
- Add a clear legend for lead-count intensity, “insufficient data”, and recurring status. Show the sample count/threshold, date range, sync freshness, and coverage indicator above the chart. Explain sessions vs caller-day leads in concise help text.
- Provide separate Day, Day & Hour, and Hour views without merging the default weekday/hour cells. Mark a cell recurring only with verified coverage in at least three of four weeks and at least the displayed minimum pooled lead count. Make threshold a named constant and keep it visible. Do not convert uncovered week/cell into zero.
- Show calls, caller-day leads, confirmed links, and suggested links as separate comparison totals beside or above the heatmap. Do not imply suggested links are conversions. Show linked completed jobs separately.
- Keep the legacy jobs-created series labeled “jobs created” if retained; it is not call conversion.

### Verification

- Test four complete week boundaries, leap/day rollover if applicable, Toronto DST transitions, day/hour cell identity (e.g. Monday 9–10 ≠ Sunday 9–10), per-week counts, repeat caller-day grouping, unknown sessions, recurring threshold, and missing coverage.
- Reconcile displayed totals and a sample of cells back to source records. Validate accessible non-color labels and keyboard detail access.

## Phase 4 — Admin deterministic insights and optional AI narrative

### Work

- Add an Admin-only `AI Insights` section and API route. Deterministic insights and the demand chart are required for V1; Gemini narrative is optional if configuration, cost, and validation permit. Dispatchers retain operational call tools; Admin-only authorization is enforced server-side.
- Compute deterministic metrics first. If Gemini is enabled, send only aggregates and metric IDs: date range, coverage, weekly/day-hour counts, sessions, known caller-day leads, unknown sessions, activity-kind counts, and confirmed/suggested link counts. Never send names, phone numbers, addresses, transcripts, free-text job descriptions, or raw call records.
- Use `src/lib/gemini-admin-insights.ts` with structured output containing insight text, evidence metric IDs, time window, sample size, caveat, suggested action, and confidence. The model may not author numeric values: render values from canonical server metrics and reject unsupported metric IDs/claims.
- Keep the narrative descriptive and cautious. Suggestions may propose small reversible staffing or ad-schedule experiments based on repeated call-demand windows; no campaign causality or automatic budget changes.
- If enabled, cache by date range and data watermark. Provide deliberate refresh, “last generated”, and “data through” timestamps. Do not invoke Gemini on every Admin dashboard load. Deterministic observations are always available when Gemini is disabled or unavailable.

### Verification

- Reject Dispatcher, Technician, Accountant, and unauthenticated access.
- Cover malformed model JSON, invalid evidence IDs, invented numeric values, sparse samples, missing Gemini config, provider errors, timeout, and fallback behavior.
- Review payloads for PII; visually verify date/week labels, Toronto hours, sample counts, legend, caveats, and insufficient-data states.

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
- **Link quality:** V1 requires human confirmation for every link. Audit confirmed links and track precision and correction rate. Any later auto-confirmation proposal requires at least 95% audited precision and under 5% correction rate on at least 50 reviewed links; if volume is lower, keep human confirmation.
- **AI integrity:** AI introduces no unsupported metric IDs, numeric values, or causal claims; deterministic metrics remain available during AI or Ads outages.
- **Operational safety:** jobs save when RingCentral is unavailable; unauthorized roles cannot read Admin Insights; link actions are auditable and reversible.
- **Decision usefulness:** after 8–12 weeks of verified coverage, run one controlled ad-schedule or staffing experiment at a time. Compare qualified caller-day leads, confirmed completed jobs, and cost per confirmed completed job only where spend period/timezone is valid. Keep an unchanged comparison period when feasible.

### Rollout

- Pilot historical suggestions and intake selection with human review. Maintain weekly snapshots of metric inputs, definitions/version, coverage, and data watermark.
- Reconsider automatic matching only after the link-quality gate. Reconsider granular Ads ingestion only after Phase 5 validation. Reconsider direct attribution only after a separate design review.
- Four weeks can reveal repeated operational demand, but cannot establish seasonality or prove Ads causation. No automatic campaign edits.

## V1 implementation order

1. Audit source routes, four-week coverage, metric definitions, timezone, and phone canonicalization/legacy compatibility.
2. Add auditable job/call links and exact linked call time.
3. Add candidate selection at intake and Admin historical review; all links require human confirmation.
4. Build deterministic session/lead/link metrics and the four-complete-week Toronto weekday × hour heatmap with week detail, legend, thresholds, coverage, and accessible non-color labels.
5. Add Admin-only deterministic insights; add grounded AI narrative only if it passes privacy, evidence-validation, cost, and reliability review.
6. Show existing daily Ads context only when aligned; defer campaign/hour ingestion and direct attribution behind their validation gates.
