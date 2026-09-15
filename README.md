# LocksmithOps-Pro

**Mobile-First Cloud Operations Management Platform for Locksmith Firms**

Replacing legacy WhatsApp dispatching with a fast call-intake workflow: prepare technician SMS drafts for review on the user's device, Ontario 13% HST calculations, contractor cash-in-hand reconciliation, digital signature capture, and proof-of-work photo attachment.

---

## 🌟 Key Features

### 1. Dispatch Desk & Call Intake (`/dispatch`)
- Rapid customer call logging designed for under 30 seconds.
- Admins and Dispatchers can record completed historical jobs with **Add Manual Job**. Manual entries capture a Toronto-local job date (defaulting to today), store `createdAt`, `completedAt`, and `paidAt` at 12:00 AM Toronto time, capture a tax-inclusive total amount collected, extract Ontario's 13% HST when marked on-books, track COGS, technician commission, payment method, and an on-books/off-books flag without sending dispatch notifications. Existing manual jobs are not backfilled. The Dispatch Desk includes an all-entry table where Admins and Dispatchers can edit or delete manual records.
- Customer phone number formatting with extension parsing (e.g., `(647) 951-0901 #762`).
- Dispatcher assigns technicians using each technician's configured commission rate.
- Prepares technician assignment SMS drafts for the user's native Messages app; the portal does not send or verify SMS delivery.
- Refresh the page after another user changes a job; there is no background live refresh.
- Customer SMS is not sent by the portal; customer communication remains a user-controlled device action.

### 2. Field Technician Mobile App (`/tech` & `/tech/jobs/[id]`)
- Mobile-first interface designed for one-hand operation on mobile phones.
- Universal routing by sequential **Job Number** (e.g. `/tech/jobs/9815`) or database UUID.
- **1-Tap Navigation**: Deep links directly to Google Maps or Apple Maps.
- **1-Tap Call**: Dial client directly with phone extension included.
- **Locksmith Hardware & Specs**:
  - Key Bitting codes (e.g., `SC1: 3-5-2-1-4`, `KW1`).
  - Door / Cam specifications (e.g., *Adams Rite 1-1/8" mortise*).
- **Dispute Prevention & Quality Proof**:
  - Touch-screen **Digital Signature Pad** (*"I authorize locksmith service & acknowledge keys received in good working order"*).
  - **Proof-of-Work Photo Attachment** for lock installations.
- **Flexible Billing Modes**:
  - **Reverse Calculation**: Enter total lump sum collected (e.g., `$1,661.77`) ➔ system automatically calculates `$1,470.59` job subtotal + `13% Ontario HST: $191.18`.
  - **Forward Calculation**: Labor + optional Parts + 13% HST.
  - **Abandoned Job Travel Fee**: Quick-charge `$20.00` or `$25.00` cancellation fee + 13% HST if a customer cancels on site.
- **Multi-Payment Settlement**:
  - 💵 **Cash**: Record physical cash received and automatically update the contractor's cash ledger.
  - 🏦 **Interac e-Transfer**: Record the payment method and automatically update the contractor's cash ledger.
  - 💳 **Credit/Debit Card (Stripe)**: Disabled for now; planned for a future release.

### 3. Customer Tracking and Online Payments
- Customer tracking and Stripe online payments are disabled for now.
- The technician sends completion details to the dispatcher, including payment method and amount received.

### 4. Admin Executive Hub & Cash Handover Settlements (`/owner`)
- **Executive KPIs**: Total Gross Revenue, Cash vs Card vs Interac splits, Ontario HST (13%) collected for CRA tax filing, and Net Company Profit.
- **RingCentral call analytics**: Admin and Dispatcher inbound call counts for the receiving number, including Toronto-local today widgets, a seven-day received-vs-converted graph, and conversion rate. Calls are read from the account Call Log API, exclude known calls shorter than 30 seconds, and count each caller once per Toronto calendar day. A conversion is an inbound caller whose normalized phone number matches a LockOps job created on the same Toronto calendar day, with an unambiguous last-four-digit fallback for formatting differences.
- **Contractor Cash-in-Hand Ledger**:
  - Tracks live cash physically held by each contractor (`Cash Collected - Commission Earned - Settled = Net Owed`).
  - **1-Click "Settle Cash Handover"**: Admin records physical cash envelopes received from contractors with complete audit notes.
- **1-Click CSV Export**: Download accountant-ready reports for QuickBooks.

### 5. Role-Based Access Control (RBAC)
- Authenticated roles: `ADMIN`, `DISPATCHER`, `TECHNICIAN`.
- Admin has full access to every workspace, operation, report, and team-management action.
- Password-based staff login on `/login`; Admin creates and manages all staff accounts.
- Route protection with contextual navigation header.

### 6. Request Failure Logging
- Every `/api/*` request emits a structured log record containing the request ID, HTTP method, path, response status, duration, and authenticated user ID / role when available.
- Failed requests include the API's returned error message; unexpected server exceptions include the exception message and stack in the server log.
- The portal UI displays the API error detail directly, including unexpected manual-job creation/update failures; stack traces remain server-side only.
- Responses include an `X-Request-Id` header so support can correlate a browser failure with its server log entry without logging passwords, request bodies, or uploaded files.

---

## 🛠️ Technology Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router, React 19, TypeScript)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Database & ORM**: [Prisma ORM](https://www.prisma.io/) with PostgreSQL (Supabase) / SQLite (Local)
- **Payments**: Cash and Interac are supported for job closeout. Card methods remain reserved until processor references can be captured and audited.
- **Messaging**: Device SMS hand-off through the user's native Messages app; the portal does not use Twilio or claim delivery.
- **Revenue email**: Completed-job revenue changes are sent through Resend to `mail2mws@gmail.com`.
- **Deployment**: [Vercel](https://vercel.com/) (Frontend & Serverless API) + [Supabase](https://supabase.com/) (Managed PostgreSQL)

---

## 🚀 Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Synchronize database schema
npx prisma db push

# 3. Create the initial admin account (no demo staff or jobs)
node prisma/seed.js

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or [http://localhost:3001](http://localhost:3001) if port 3000 is occupied).

---

## ☁️ Deployment (Vercel + Supabase)

This application runs **100% free of charge** on Vercel and Supabase free tiers:

1. Create a free project at [supabase.com](https://supabase.com).
2. Set datasource in `prisma/schema.prisma` to `provider = "postgresql"` and add connection strings.
3. Push to GitHub and import repository into [vercel.com](https://vercel.com).
4. Set environment variables in Vercel:
   - `POSTGRES_PRISMA_URL`: *(Supabase/Vercel pooled PostgreSQL URL)*
   - `POSTGRES_URL_NON_POOLING`: *(Supabase/Vercel direct, non-pooling PostgreSQL URL)*
   - `ADMIN_PASSWORD`: *(Strong password for the built-in Admin login; required in production)*
   - `NEXT_PUBLIC_APP_URL`: `https://your-project.vercel.app`
   - *(Optional RingCentral)* `RC_APP_CLIENT_ID`, `RC_APP_CLIENT_SECRET`, and `RC_REDIRECT_URI` for the RingCentral OAuth app. Register `RC_REDIRECT_URI` as `https://your-project.vercel.app/api/ringcentral/callback` and enable the `ReadCallLog` permission. Set `RC_TARGET_PHONE_NUMBER` to override the default receiving number `(416) 240-0593`.
   - *(Optional server-to-server RingCentral auth)* `RC_USER_JWT` can be used instead of the interactive Admin Hub connection flow.
   - Run `prisma/ringcentral-connection-migration.sql` once against production so an OAuth connection is shared between Admin and Dispatcher dashboards. This is not needed when using `RC_USER_JWT`.
   - *(Optional)* `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

5. Before deploying a version that includes dispatcher edits or manual-job intake
   windows, apply both one-time additive migrations against the production database:
   `prisma/job-updated-at-migration.sql` and
   `prisma/manual-job-received-time-migration.sql`. These add `Job.updatedAt` for
   edit concurrency and `Job.jobReceivedTimeSlot` for manual-job intake windows.
   Verify both columns exist before serving the new application build.

Detailed step-by-step instructions can be found in [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## 🧪 Testing

```bash
# Run unit financial calculation tests (HST 13%, Reverse Mode)
node --experimental-strip-types tests/calculations.test.ts

# Run production E2E integration test suite
node --experimental-strip-types tests/production-e2e.test.ts

# Verify production build compilation
npm run build
```

### Viewing production logs

The deployed portal runs its API routes as Vercel serverless functions. Open the Vercel project, select **Logs**, and search for `portal_api_request` or the reported `X-Request-Id`. HTTP 4xx failures are warnings and 5xx failures / uncaught exceptions are errors. These logs are platform logs rather than records stored in the portal database; a persistent Admin log viewer can be added separately if needed.

---

## 📄 License
Private & Proprietary - LockOps Pro.
