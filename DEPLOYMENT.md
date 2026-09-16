# Deployment Guide: Free Hosting on Vercel & Supabase

This project is tailored specifically for **Vercel** (Frontend & Serverless API) and **Supabase** (Managed PostgreSQL Database). For low-to-medium operational volume, **this entire stack runs 100% free of charge**.

---

## 💰 Free Tier Breakdown

| Provider | Free Tier Allowance | Fits Locksmith Operations? |
| :--- | :--- | :--- |
| **Vercel (Hobby)** | • Unlimited deployments<br>• Automated CI/CD from GitHub<br>• Free custom domain & SSL HTTPS<br>• 100 GB bandwidth / mo<br>• Fast Edge CDN | **Yes, 100% Free**. Admins, dispatchers, and technicians can access the system with zero hosting fees. |
| **Supabase (Free Tier)** | • 500 MB PostgreSQL Database<br>• 50,000 Monthly Active Users<br>• Supavisor Connection Pooling (Port 6543)<br>• Daily backups | **Yes, 100% Free**. 500 MB easily stores over **100,000+ locksmith jobs**, invoices, and customer records. |

---

## 🚀 5-Step Deployment Walkthrough

### Step 1: Create a Free Supabase Database
1. Go to [supabase.com](https://supabase.com) and create a free account.
2. Click **"New Project"**, name it (e.g. `locksmith-operations`), and set a strong database password.
3. Select the region closest to your operations (e.g., `East US (N. Virginia)` or `Central Canada`).
4. Once the project is provisioned, go to **Project Settings** (gear icon) ➔ **Database** ➔ **Connection string**.
5. Copy two URLs:
   - **Transaction Pooler (Port 6543)** with Mode `Transaction` (this is your `POSTGRES_PRISMA_URL`).
   - **Direct Connection (Port 5432)** with Mode `Session` (this is your `POSTGRES_URL_NON_POOLING`).

---

### Step 2: Configure Prisma for PostgreSQL
In `prisma/schema.prisma`, update the datasource block to:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("POSTGRES_PRISMA_URL")
  directUrl = env("POSTGRES_URL_NON_POOLING")
}
```

Create your local `.env` file with these values:
```env
POSTGRES_PRISMA_URL="postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true"
POSTGRES_URL_NON_POOLING="postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
```

---

### Step 3: Push Schema and Seed Database
Run the following commands in your terminal to initialize tables and load initial data on Supabase:

```bash
# This is a new production database: create the schema directly from Prisma
npx prisma db push

# Create the initial Admin account. Set ADMIN_PASSWORD first.
node prisma/seed.js
```

Before deploying the cache-backed RingCentral analytics, also apply
`prisma/ringcentral-call-cache-migration.sql` once against the production
database. The normal analytics GET endpoint reads only cached rows from these
tables. RingCentral is contacted only when an Admin or Dispatcher clicks
**Refresh calls**, which invokes the authenticated refresh POST endpoint.

The migration stores detailed call-log fields plus the original JSON payload,
supports multiple configured destination numbers, and records the last
successful sync and any refresh error. It is additive and safe to re-run.

The Prisma schema is the single source of truth for this new database. No role-consolidation or manual-job SQL migration is required when production starts empty. Set a strong `ADMIN_PASSWORD` in production; it also signs login cookies, and the application fails closed when it is missing.

For an existing database, apply schema changes before deploying application code. The job-number identifier migration is available at `prisma/job-number-string-migration.sql`; run it once against the production database, or use `npx prisma db push` after verifying the diff.

Before deploying a build that uses the additive dispatcher-edit and manual-job fields, apply both compatibility migrations to an existing production database:

- `prisma/job-updated-at-migration.sql` adds `Job.updatedAt` for dispatcher edit concurrency.
- `prisma/manual-job-received-time-migration.sql` adds `Job.jobReceivedTimeSlot` for the manual-job intake window.

These migrations are additive and preserve existing job business data. Existing rows receive a migration-time default for the new non-null `updatedAt` column, while existing `jobReceivedTimeSlot` values remain `NULL` until a manual job is edited or recorded with a time window. Verify both columns exist before serving the new application build.

Required production environment variables:

```env
POSTGRES_PRISMA_URL="..."
POSTGRES_URL_NON_POOLING="..."
ADMIN_PASSWORD="a-strong-admin-password"
NEXT_PUBLIC_APP_URL="https://your-domain.example"
```

`ADMIN_PASSWORD` is used only for the built-in Admin login. Staff accounts created from the Admin console receive their own password hash. Do not use the development fallback password in production.

### Google Ads ROI setup

The Admin dashboard pulls Google Ads spend when an Admin clicks **Sync today**, **Sync yesterday**, **Sync last week**, or **Sync all time**. Spend is cached in `GoogleAdsDailyMetric`, so opening the dashboard never calls Google Ads automatically. The ROI widget supports these Toronto calendar periods: Today, Yesterday, the trailing seven days, and All time beginning September 7, 2026, when the company started. It compares spend with net profit, not revenue. Net profit uses the existing accounting definition: paid gross invoices minus HST, technician commissions, and parts cost. The default **ROI for partner** view splits that profit equally between the two partners before calculating ROI; **ROI for company** uses the full company profit.

Google Ads does not use a single API key for this integration. Google requires an OAuth 2.0 client, a refresh token, and a Google Ads developer token. The account customer ID is also required. See Google’s official [authorization and HTTP headers guide](https://developers.google.com/google-ads/api/rest/auth).

Add these server-only variables to Vercel and local development as needed:

```env
GOOGLE_ADS_DEVELOPER_TOKEN="..."
GOOGLE_ADS_CLIENT_ID="...apps.googleusercontent.com"
GOOGLE_ADS_CLIENT_SECRET="..."
GOOGLE_ADS_REFRESH_TOKEN="..."
GOOGLE_ADS_CUSTOMER_ID="1234567890"

# Required only when the OAuth user reaches the account through a manager account.
GOOGLE_ADS_LOGIN_CUSTOMER_ID="0987654321"

# Optional; defaults to CAD for display and v25 for the Google Ads REST endpoint.
GOOGLE_ADS_CURRENCY_CODE="CAD"
GOOGLE_ADS_API_VERSION="v25"
```

To obtain the values:

1. In Google Ads, create or use a Manager account and open **Admin → API Center**. Copy the developer token. Google documents that a developer token is required on every API request and that its access level controls production access.
2. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project, enable the Google Ads API, configure the OAuth consent screen, and create an OAuth client ID for a server-side web/desktop application. Keep the client secret private.
3. Authorize the Google account that can access the target Ads account with the scope `https://www.googleapis.com/auth/adwords` and request offline access. Exchange the authorization result for a refresh token. Google’s [single-user authentication guide](https://developers.google.com/google-ads/api/docs/oauth/single-user-authentication) describes this flow.
4. Copy the 10-digit client account ID from Google Ads into `GOOGLE_ADS_CUSTOMER_ID`, removing hyphens. If the authorized Google user enters the account through a Manager account, put that Manager ID, also without hyphens, in `GOOGLE_ADS_LOGIN_CUSTOMER_ID`; otherwise leave it unset.
5. Apply `prisma/google-ads-daily-metric-migration.sql` once to an existing production database, or run `npx prisma db push` for a new database, before deploying the code.

The current implementation reports blended portal profit against account-level Google Ads spend. For exact ad-attributed ROI, jobs will also need a source/conversion attribution field and a matching Google Ads conversion workflow.

You can now open the **Supabase Table Editor** in your browser and verify that all tables (`Job`, `User`, `Customer`, `Invoice`, `Settlement`) are populated!

---

### Step 4: Push Code to GitHub
Initialize Git (if not already done) and push to your GitHub account:

```bash
git init
git add .
git commit -m "Initial commit: Locksmith Operations System"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/locksmith-operations.git
git push -u origin main
```

---

### Step 5: Deploy to Vercel
1. Go to [vercel.com](https://vercel.com) and log in with GitHub.
2. Click **"Add New..."** ➔ **"Project"**.
3. Import your `locksmith-operations` repository.
4. Under **Environment Variables**, add:
   - `POSTGRES_PRISMA_URL`: *(Your Supabase pooled connection string from Step 1)*
   - `POSTGRES_URL_NON_POOLING`: *(Your Supabase direct connection string from Step 1)*
   - `ADMIN_PASSWORD`: *(Strong password for the initial Admin login; required in production)*
   - `NEXT_PUBLIC_APP_URL`: `https://your-project-name.vercel.app` *(or your custom domain)*
   - `RESEND_API_KEY`: *(Resend API key from the Omnibroker workspace)*
   - `RESEND_FROM_EMAIL`: *(A verified Omnibroker sender address, for example `LockOps <notifications@your-domain.com>`)*
   - *(Optional)* `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
5. Click **"Deploy"**.

Vercel will run `prisma generate && next build` automatically. Within 60 seconds, your application will be live with a secure HTTPS URL!

---

## 🔒 Production Webhook Configuration

### Stripe Webhook (Instant Job Closeout)
1. Go to **Stripe Dashboard** ➔ **Developers** ➔ **Webhooks**.
2. Add an endpoint pointing to:
   `https://your-app.vercel.app/api/webhooks/stripe`
3. Select event: `checkout.session.completed`.
4. Copy the Signing Secret into Vercel as `STRIPE_WEBHOOK_SECRET`.

### Device SMS
- The portal prepares an `sms:` link and message preview for the dispatcher or technician.
- The user must review the draft, open the native Messages app, and tap Send. The portal cannot verify delivery.
- No Twilio credentials are required or used by active job routes.

### Revenue email
- Manual-job creation, manual revenue edits, normal job completion, and abandoned-job travel-fee closeout send an accounting summary through Resend to `mail2mws@gmail.com`.
- Email delivery failure does not roll back the job or revenue mutation; the API response includes `revenueEmail.success` and an error when available.
