# LocksmithOps-Pro

**Mobile-First Cloud Operations Management Platform for Locksmith Firms**

Replacing legacy WhatsApp dispatching with an automated end-to-end workflow: Fast call intake (<30s), automated Twilio SMS dispatch, Ontario 13% HST calculations (with reverse tax-inclusive split), Stripe payment links with 4% fixed surcharge, contractor cash-in-hand reconciliation, digital signature capture, proof-of-work photo attachment, and customer live service tracking.

---

## 🌟 Key Features

### 1. Dispatch Desk & Call Intake (`/dispatch`)
- Rapid customer call logging designed for under 30 seconds.
- Customer phone number formatting with extension parsing (e.g., `(647) 951-0901 #762`).
- Dispatcher assigns technician and explicitly enters the **worker commission** for each job.
- Dispatches job alerts via **Twilio SMS** directly to the technician's phone.
- **🟢 Live Sync**: Real-time auto-polling queue updating status changes across the team.

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
  - 💵 **Cash**: Record physical cash received; toggle SMS receipt (Default: OFF); automatically updates contractor's cash ledger.
  - 🏦 **Interac e-Transfer**: Record confirmation reference.
  - 💳 **Credit/Debit Card (Stripe)**: Automatically adds fixed **+4% card surcharge**; generates Twilio SMS checkout link.

### 3. Customer Live Service Tracker (`/track/[id]`)
- Real-time customer portal showing live status progression (`Assigned` ➔ `En Route` ➔ `On Site` ➔ `In Progress` ➔ `Completed`).
- 1-Tap "Call Locksmith" button.
- Embedded secure payment link & digital receipt.

### 4. Owner Executive Hub & Cash Handover Settlements (`/owner`)
- **Executive KPIs**: Total Gross Revenue, Cash vs Card vs Interac splits, Ontario HST (13%) collected for CRA tax filing, and Net Company Profit.
- **Contractor Cash-in-Hand Ledger**:
  - Tracks live cash physically held by each contractor (`Cash Collected - Commission Earned - Settled = Net Owed`).
  - **1-Click "Settle Cash Handover"**: Owner records physical cash envelopes received from contractors with complete audit notes.
- **1-Click CSV Export**: Download accountant-ready reports for QuickBooks.

### 5. Role-Based Access Control (RBAC)
- Authenticated roles: `OWNER`, `DISPATCHER`, `TECHNICIAN`.
- **1-Tap Team Login** on `/login` for seamless testing and staff sign-in.
- Route protection with contextual navigation header.

---

## 🛠️ Technology Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router, React 19, TypeScript)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Database & ORM**: [Prisma ORM](https://www.prisma.io/) with PostgreSQL (Supabase) / SQLite (Local)
- **Payments**: [Stripe](https://stripe.com/) Checkout Sessions & Webhooks
- **Messaging**: [Twilio](https://www.twilio.com/) Programmable SMS API
- **Deployment**: [Vercel](https://vercel.com/) (Frontend & Serverless API) + [Supabase](https://supabase.com/) (Managed PostgreSQL)

---

## 🚀 Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Synchronize database schema
npx prisma db push

# 3. Seed demo staff and sample jobs
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
   - `DATABASE_URL`: *(Supabase Transaction Pooler URL - Port 6543)*
   - `DIRECT_URL`: *(Supabase Direct Connection URL - Port 5432)*
   - `NEXT_PUBLIC_APP_URL`: `https://your-project.vercel.app`
   - *(Optional)* `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
   - *(Optional)* `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

Detailed step-by-step instructions can be found in [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## 🧪 Testing

```bash
# Run unit financial calculation tests (HST 13%, Reverse Mode, 4% Surcharge)
node --experimental-strip-types tests/calculations.test.ts

# Run production E2E integration test suite
node --experimental-strip-types tests/production-e2e.test.ts

# Verify production build compilation
npm run build
```

---

## 📄 License
Private & Proprietary - LockOps Pro.
