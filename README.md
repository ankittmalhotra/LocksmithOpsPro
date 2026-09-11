# LocksmithOps-Pro

**Mobile-First Cloud Operations Management Platform for Locksmith Firms**

Replacing legacy WhatsApp dispatching with a fast call-intake workflow: prepare technician SMS drafts for review on the user's device, Ontario 13% HST calculations, contractor cash-in-hand reconciliation, digital signature capture, and proof-of-work photo attachment.

---

## 🌟 Key Features

### 1. Dispatch Desk & Call Intake (`/dispatch`)
- Rapid customer call logging designed for under 30 seconds.
- Admins and Dispatchers can record completed historical jobs with **Add Manual Job**. Manual entries capture a tax-inclusive total amount collected, extract Ontario's 13% HST when marked on-books, track COGS, technician commission, payment method, and an on-books/off-books flag without sending dispatch notifications. The Dispatch Desk includes an all-entry table where Admins and Dispatchers can edit or delete manual records.
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
- **Contractor Cash-in-Hand Ledger**:
  - Tracks live cash physically held by each contractor (`Cash Collected - Commission Earned - Settled = Net Owed`).
  - **1-Click "Settle Cash Handover"**: Admin records physical cash envelopes received from contractors with complete audit notes.
- **1-Click CSV Export**: Download accountant-ready reports for QuickBooks.

### 5. Role-Based Access Control (RBAC)
- Authenticated roles: `ADMIN`, `DISPATCHER`, `TECHNICIAN`.
- Admin has full access to every workspace, operation, report, and team-management action.
- Password-based staff login on `/login`; Admin creates and manages all staff accounts.
- Route protection with contextual navigation header.

---

## 🛠️ Technology Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router, React 19, TypeScript)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Database & ORM**: [Prisma ORM](https://www.prisma.io/) with PostgreSQL (Supabase) / SQLite (Local)
- **Payments**: Cash and Interac are supported for job closeout. Card methods remain reserved until processor references can be captured and audited.
- **Messaging**: Device SMS hand-off through the user's native Messages app; the portal does not use Twilio or claim delivery.
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
   - *(Optional)* `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

5. Before deploying a version that includes dispatcher edit concurrency, apply the
   one-time schema change from `prisma/job-updated-at-migration.sql` against the
   production database. This adds `Job.updatedAt`, which prevents stale dispatcher
   forms from overwriting a newer edit. Verify the column exists before serving the
   new application build.

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

---

## 📄 License
Private & Proprietary - LockOps Pro.
