# LockOps Pro Public Homepage — UX and Implementation Plan

## 1. Product outcome

Turn `/` from an internal workspace chooser into a public-facing product page that clearly explains LockOps Pro as the operating system for locksmith businesses: from the first inbound call, through dispatch and field work, to payment, proof of work, reconciliation, and owner reporting.

The page should make a locksmith owner think: “This replaces the duct-taped tools we use today, and it gives me control of the whole job.”

Primary conversion goal: get a qualified locksmith business to sign in, request a walkthrough, or start a conversation without weakening the existing staff login flow.

Secondary goals:

- Help owners understand the business value, not just the feature list.
- Help dispatchers and technicians recognize themselves in the workflow.
- Make the product feel credible, specialized, fast, and operationally serious.
- Give future roadmap features a visible but honest place without presenting them as shipped functionality.

## 2. Documentation and codebase discovery

### Sources consulted

- `src/app/page.tsx:14-155` — current home route, session lookup, role-aware workspace links, and current product positioning.
- `src/app/layout.tsx:1-34` — global metadata, viewport settings, page shell, navigation inclusion, and footer.
- `src/components/NavigationHeader.tsx:15-141` — authenticated navigation behavior and the current exception that hides the app header on `/` and `/login`.
- `README.md:1-56` — product positioning, shipped feature inventory, roles, workflows, and current operational constraints.
- `src/app/dispatch/page.tsx:1-230` — dispatch intake state and the breadth of dispatcher workflows represented in the UI.
- `src/app/owner/page.tsx:1-220` — executive analytics, team management, settlement, and Google Ads ROI entry points.
- `src/app/tech/page.tsx:1-219` — mobile technician queue, active-job statuses, and completed-job workflow.
- `src/app/tech/jobs/[id]/page.tsx` — field execution, navigation/call actions, billing, signatures, and proof-of-work interactions.
- `prisma/schema.prisma:1-260` — domain model evidence for roles, job lifecycle, locksmith fields, automotive fields, scheduling, invoices, payments, settlements, and analytics caches.
- `package.json:1-26` — supported implementation stack: Next.js App Router, React, TypeScript, Tailwind CSS, and `lucide-react`.

### Allowed implementation patterns

- Use the existing Next.js App Router route at `src/app/page.tsx`.
- Use existing `next/link` links for internal navigation and existing `/login`, `/dispatch`, `/owner`, and `/tech` routes.
- Use Tailwind utility classes and the existing global tokens/styles in `src/app/globals.css`.
- Use `lucide-react` for product/UI icons; do not introduce an emoji-based icon system for the marketing page.
- Keep the existing `/api/auth/me` session lookup if the page needs an authenticated “Go to workspace” state.
- Update `src/app/layout.tsx` metadata and the existing footer as part of the public-page polish.
- Keep role-based app navigation in `NavigationHeader`; the public homepage should have its own marketing header because `NavigationHeader` intentionally returns `null` for `/`.

### Anti-patterns to avoid

- Do not invent a signup, demo, pricing, or lead-capture endpoint before a real destination exists. Use `/login` for the existing authenticated action and an anchor-based “See how it works” CTA until a business CTA is approved.
- Do not claim automated SMS delivery: the current product prepares native Messages drafts and leaves sending under the user’s control (`README.md:16-18`).
- Do not claim card payments are fully live without reconciling the Stripe description in `README.md:38-42` with the implementation note in `README.md:71`; label it as “Stripe payment links / payment flow” only if verified in the target deployment.
- Do not expose customer, revenue, or call data on the public page.
- Do not make the marketing page dependent on a successful session request; logged-out visitors must see the complete page even if `/api/auth/me` fails.
- Do not add fake testimonials, customer logos, review counts, ROI percentages, or performance claims without evidence.
- Do not make the public page a second internal dashboard or send unauthenticated visitors to role-specific screens as the primary experience.

## 3. UX strategy

### Core positioning

Recommended headline:

> Run every locksmith job from first call to final payment.

Recommended supporting copy:

> LockOps Pro gives locksmith owners, dispatchers, and field technicians one fast workspace for dispatching jobs, closing out work, collecting payment, and knowing exactly where the business stands.

Supporting proof line:

> Built for lockouts, rekeys, commercial service, automotive work, scheduled jobs, and the realities of running a locksmith team.

The page should sell the operational loop, not a random collection of features:

```text
Inbound call → Job intake → Dispatch → Field execution → Proof & payment → Reconciliation → Owner insight
```

### Audience paths

The first screen should serve all three audiences, then let each self-select:

- Owner: “See the numbers that matter.”
- Dispatcher: “Move jobs from phone call to technician in seconds.”
- Technician: “Finish every job from your phone.”

These are content paths, not separate routes. They should scroll to sections on the same page.

### Page information architecture

1. Public navigation and conversion header.
2. Hero: category, promise, operational loop, primary CTA, secondary CTA.
3. Trust/proof strip using truthful product capabilities, not invented metrics.
4. “Stop stitching together five tools” problem framing.
5. End-to-end workflow visualization.
6. Feature pillars for Dispatch, Field, and Business control.
7. Full feature inventory grouped by job lifecycle.
8. Locksmith-specific details: residential, commercial, and automotive.
9. Owner-control section: revenue, HST, commission, settlements, call conversion, marketing ROI.
10. Recommended roadmap section labeled clearly as “Next for LockOps”.
11. FAQ focused on fit, roles, payment behavior, mobile use, and security.
12. Final CTA and public footer.

## 4. Visual design direction

Create a premium B2B field-service aesthetic: dark navy foundation, warm amber action color, electric blue for dispatch, emerald for field completion, and clean white surfaces for information density.

- Replace the current emoji-led visual language with Lucide icons and a small set of consistent icon containers.
- Use a dark hero with a subtle grid or blueprint texture made in CSS; avoid stock locksmith imagery unless a real brand asset is supplied.
- Use a large product mockup or composed UI preview that shows dispatch, technician status, and business metrics together. This can initially be a carefully designed static composition using existing UI patterns; it must not imply live data.
- Keep corners and shadows restrained: the current app is heavily rounded and card-driven, so the public page should feel more editorial and confident while still matching the product.
- Use short paragraphs, strong section labels, and generous spacing. The page will be long, but it should never feel like a wall of features.
- Use a visible sticky mobile CTA after the hero, but do not obscure content or the footer.
- Support keyboard navigation, visible focus states, reduced motion, semantic headings, and sufficient color contrast.

## 5. Shipped feature inventory to present

The implementation should use this as the source-of-truth feature catalog. Each feature should be described by the operational outcome first, then the mechanism.

### Dispatch and call intake

- Rapid call logging designed for fast intake.
- Customer name, phone, extension, address, service type, and problem description.
- Technician assignment using configured commission rates.
- Scheduled appointments and intake windows.
- Manual entry for historical/completed jobs.
- Native SMS draft handoff for technician assignments.
- Automotive intake fields: vehicle year, make, model, VIN, key type, and FCC ID.
- Dispatch job list, status visibility, and manual record management.
- Role-based access for owners and dispatchers.

### Field technician workflow

- Mobile-first one-hand job queue.
- One-tap job acknowledgment and status progression.
- One-tap maps navigation.
- One-tap customer calling with extensions supported.
- Locksmith hardware and door/cam details.
- Key bitting capture.
- Pre-work authorization signature.
- Customer completion signature.
- Proof-of-work photo attachment.
- Forward invoice calculation: labor plus parts plus tax.
- Reverse invoice calculation from the total collected.
- Abandoned-job travel fee handling.
- Cash and Interac payment capture.
- Commission visibility for the assigned technician.

### Payments, closeout, and records

- Ontario HST calculation and tax visibility.
- Payment status and payment method tracking.
- Customer invoice/receipt communication flow where enabled.
- Stripe-hosted payment-link flow where production configuration is verified.
- Completed-job revenue records.
- Structured API request IDs and failure logging for supportability.

### Owner and business control

- Gross revenue, payment-method splits, HST, and net-profit KPIs.
- Contractor cash-in-hand ledger.
- Commission tracking.
- Cash handover settlement records and notes.
- Inbound call analytics and received-versus-converted view through RingCentral where configured.
- Google Ads ROI view where configured.
- CSV export for accountant/QuickBooks workflows.
- Team member creation and role management.
- Admin, dispatcher, and technician role-based access control.

## 6. Additional features to propose, not claim as shipped

These should be shown in a restrained “Next for LockOps” roadmap block or retained as product backlog items. They are valuable because they complete the locksmith business operating system, but they should not appear in the live feature inventory until implemented.

### Highest-value additions

- Customer history and repeat-customer profiles with previous locks, keys, invoices, and notes.
- Quote and estimate templates by service type, with approval tracking.
- Automated customer status messages for “technician assigned”, “on the way”, and “job complete”, with delivery status.
- Online booking/request form with service-area and availability rules.
- Recurring commercial maintenance reminders and renewal follow-ups.
- Parts and key-blank inventory with low-stock alerts and job-level consumption.
- Photo/document timeline for every job, including before/after evidence.
- Route and territory planning for scheduled work.
- Service-area pricing, after-hours pricing, and configurable travel fees.
- Expense tracking and margin by service type, technician, and lead source.
- Audit log visible to admins for edits, settlements, payment changes, and role changes.
- Offline-tolerant technician mode with queued updates for poor-signal locations.

### Later-stage opportunities

- Multi-location and branch support.
- Phone-call transcription and structured intake assistance.
- Lead-source attribution beyond Google Ads.
- Customer review request automation.
- Payroll/contractor payout exports.
- Public booking widgets for a locksmith company website.
- Permission sets beyond the current three roles.

Roadmap copy should use language such as “on the roadmap” or “coming next,” never “included,” until the relevant workflow exists and is tested.

## 7. Phased implementation plan

### Phase 0 — Content, truth, and design contract

**What to implement**

- Confirm the product name, primary CTA destination, target geography, and whether the public page should say “Ontario HST” or use a more location-neutral tax phrase.
- Mark every feature as `shipped`, `configured/integration-dependent`, or `roadmap`.
- Approve the positioning, headline, CTA labels, and the three-audience messaging.
- Define the visual tokens: navy, amber, blue, emerald, neutral surfaces, typography scale, spacing, radius, and shadow rules.
- Decide whether a real screenshot/product image will be supplied or whether the first release uses a CSS/UI composition.

**Documentation references**

- Copy product facts from `README.md:9-56` and domain evidence from `prisma/schema.prisma:1-260`.
- Preserve the existing route/session behavior in `src/app/page.tsx:14-45`.
- Use the existing stack from `package.json:1-26`.

**Verification checklist**

- Every public feature statement maps to a README, UI, API, or schema source.
- All integration-dependent claims have a visible qualifier.
- No CTA links to an unimplemented route.
- The approved content hierarchy fits the intended page length and mobile experience.

**Anti-pattern guards**

- No invented metrics, testimonials, awards, or customer names.
- No promise of background live refresh, automatic SMS delivery, or unsupported card capability.

### Phase 1 — Public page shell and conversion header

**What to implement**

- Replace the current workspace chooser in `src/app/page.tsx` with the public page shell.
- Add a branded public header with logo/wordmark, anchor links to Features, Workflow, and FAQ, a “Sign in” link to `/login`, and a primary CTA that has an approved real destination.
- Keep a compact authenticated state: if a user is signed in, show “Open Dispatch”, “Open Technician Portal”, or “Open Admin Hub” based on role, while still allowing the user to browse the page.
- Keep public navigation separate from `NavigationHeader`, whose current pathname guard at `src/components/NavigationHeader.tsx:48-50` intentionally omits the internal header from `/`.
- Update global metadata in `src/app/layout.tsx:5-8` to match the public positioning, and update the footer in `src/app/layout.tsx:29-30` with product and privacy/contact placeholders only if real destinations exist.

**Documentation references**

- Copy the existing role-aware destination logic from `src/app/page.tsx:42-80`.
- Copy internal-link patterns from `src/components/NavigationHeader.tsx:57-135`.
- Use Tailwind conventions from `src/app/globals.css:1-32` and the configured content paths in `tailwind.config.ts`.

**Verification checklist**

- Logged-out visitors can load `/` without waiting for or depending on `/api/auth/me`.
- Logged-in users still get a clear role-appropriate workspace action.
- Header anchor links work on desktop and mobile.
- `/login`, `/dispatch`, `/owner`, and `/tech` remain reachable.
- `npm run build` succeeds.

**Anti-pattern guards**

- Do not remove role routing or expose admin/dispatcher links as the primary logged-out CTA.
- Do not put internal job or customer data into the page payload.

### Phase 2 — Hero, problem framing, and workflow story

**What to implement**

- Build the hero around the complete locksmith workflow, not a generic “software platform” claim.
- Add two clear actions: one existing/authenticated action and one page-navigation action until a real sales/signup endpoint is approved.
- Add a concise “before / after” problem framing: scattered calls, chats, notes, and cash records versus one accountable job record.
- Add a horizontal/vertical workflow visualization for Call → Dispatch → Field → Payment → Reconcile → Grow.
- Add audience entry points for owner, dispatcher, and technician.

**Documentation references**

- Use the current tagline and role split from `src/app/page.tsx:84-139` as the starting content, then expand it using `README.md:11-50`.
- Use job lifecycle and status evidence from `prisma/schema.prisma` (`JobStatus`, `Job`, and `Invoice`).

**Verification checklist**

- A first-time visitor can explain what the product does after reading only the hero and workflow.
- The page communicates three roles without creating three disconnected product stories.
- Visual hierarchy makes the main CTA obvious at 320px, 768px, and desktop widths.
- No section relies on decorative imagery to communicate a product capability.

**Anti-pattern guards**

- Avoid generic SaaS language such as “transform your business” without a locksmith-specific operational example.
- Avoid animation that delays comprehension or causes motion issues.

### Phase 3 — Feature system and product proof

**What to implement**

- Create reusable feature-card and feature-section patterns that can display the shipped feature inventory without duplicating markup.
- Present the three major pillars: Dispatch Desk, Technician App, and Owner Hub.
- Add deeper locksmith-specific panels for residential/commercial work, automotive work, proof-of-work, and payment/closeout.
- Include a static product preview that reuses the visual language of the current dispatch, technician, and owner screens.
- Include an honest integration note for RingCentral, Stripe, Google Ads, and native SMS handoff.
- Add the “Next for LockOps” roadmap block using only the proposed future features from this plan.

**Documentation references**

- Feature copy: `README.md:11-50`.
- Dispatch UI evidence: `src/app/dispatch/page.tsx:1-230`.
- Technician UI evidence: `src/app/tech/page.tsx:71-219` and `src/app/tech/jobs/[id]/page.tsx`.
- Owner UI evidence: `src/app/owner/page.tsx:72-220` and `src/components/RingCentralCallAnalytics.tsx`.
- Domain fields for hardware, automotive, scheduling, signatures, proof photos, invoices, and settlements: `prisma/schema.prisma:40-260`.

**Verification checklist**

- Every shipped feature appears once in the right feature group, without contradictory language.
- Integration-dependent features have clear availability wording.
- Feature cards remain scannable on mobile and do not become a 30-item grid with equal visual weight.
- Roadmap items are visually and verbally distinct from shipped functionality.
- Product preview is clearly illustrative and contains no real customer data.

**Anti-pattern guards**

- Do not copy internal dashboard text verbatim when it is too operational or implementation-specific for public marketing.
- Do not expose sensitive tax IDs, phone numbers, email addresses, or real analytics values.
- Do not use a chart with fabricated data as if it were a customer result.

### Phase 4 — Trust, FAQ, accessibility, and responsive polish

**What to implement**

- Add FAQ items for: who it is for, role access, mobile technician use, SMS behavior, payments, HST, RingCentral/Google Ads integrations, and data/security expectations.
- Add a trust strip based on real product properties: mobile-first, role-based, locksmith-specific fields, auditable settlement workflow, and accountant-friendly export.
- Add accessible labels, landmark structure, heading order, keyboard focus, reduced-motion handling, and touch targets.
- Tune mobile behavior: nav menu, stacked hero, sticky CTA, workflow rail, feature accordions or horizontal scroll where appropriate, and footer wrapping.
- Add lightweight structured metadata only for claims that are actually true; avoid fake ratings and unsupported review schema.

**Documentation references**

- Existing mobile/touch intent: `README.md:20-38` and `src/app/globals.css:27-31`.
- Existing global shell and viewport: `src/app/layout.tsx:10-30`.
- Existing product stack: `package.json:1-26`.

**Verification checklist**

- Test at 320px, 375px, 768px, 1024px, and wide desktop widths.
- Run keyboard-only navigation through every CTA, anchor, FAQ control, and mobile menu.
- Check contrast and focus states.
- Check reduced-motion behavior.
- Confirm metadata title/description render correctly and page content is indexable.

**Anti-pattern guards**

- Do not set `user-scalable=no` as a new marketing-page requirement; review the existing viewport restriction in `src/app/layout.tsx:10-15` because public pages should remain accessible to zoom users.
- Do not use hover-only disclosures for essential feature information.

### Phase 5 — Verification and launch readiness

**What to implement**

- Run the production build and existing tests.
- Perform a manual product-truth review against README, route behavior, and schema.
- Validate every link and anchor.
- Inspect the page in a real mobile viewport and one desktop viewport.
- Review page performance: avoid unnecessary client state, large images, and hydration for static sections.
- Confirm the authenticated entry state still works for ADMIN, DISPATCHER, and TECHNICIAN roles.

**Documentation references**

- Existing build/test commands: `README.md:88-153`.
- Existing session destinations: `src/app/page.tsx:42-80`.
- Existing navigation behavior: `src/components/NavigationHeader.tsx:41-50`.

**Verification checklist**

- `npm run build` passes.
- Existing unit and integration tests pass.
- No broken internal links or console errors on `/`.
- No public API request is required for basic page rendering.
- Search/social metadata reflects the final approved positioning.
- Manual sign-off confirms the page is truthful, legible, and persuasive to a locksmith owner.

**Anti-pattern guards**

- Do not ship the public page while the primary CTA points to a placeholder route.
- Do not call the page finished based only on a successful build; complete the responsive and accessibility checks.

## 8. Recommended first release scope

For the first implementation pass, ship Phases 0–3 with a concise FAQ and baseline responsive/accessibility work from Phase 4. Defer complex lead capture, pricing, testimonials, and roadmap functionality until the business rules and destinations exist.

The first release should be a high-quality marketing surface over the product that already exists, not a promise of an unbuilt CRM, inventory system, or automated communications platform.

## 9. Success criteria

- A locksmith owner can understand the complete value proposition in under one minute.
- A dispatcher can identify the call-to-cash workflow in one scroll.
- A technician can see that the product is designed for their phone and actual job conditions.
- The page lists the full shipped feature set in a structured, scannable way.
- Future features are presented as a roadmap, not misrepresented as live.
- The public experience feels substantially more credible and professional than the current internal workspace chooser.
