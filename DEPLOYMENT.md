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
tables. The Admin and Dispatch dashboards invoke the authenticated refresh
POST endpoint when they load, and users can also click **Refresh calls**.

The migration stores detailed call-log fields plus the original JSON payload,
supports multiple configured destination numbers, and records the last
successful sync and any refresh error. It is additive and safe to re-run.

The Prisma schema is the single source of truth for this new database. No role-consolidation or manual-job SQL migration is required when production starts empty. Set a strong `ADMIN_PASSWORD` in production; it also signs login cookies, and the application fails closed when it is missing.

For an existing database, apply schema changes before deploying application code. The job-number identifier migration is available at `prisma/job-number-string-migration.sql`; run it once against the production database, or use `npx prisma db push` after verifying the diff.

Before deploying a build that uses the additive dispatcher-edit and manual-job fields, apply both compatibility migrations to an existing production database:

- `prisma/job-updated-at-migration.sql` adds `Job.updatedAt` for dispatcher edit concurrency.
- `prisma/manual-job-received-time-migration.sql` adds `Job.jobReceivedTimeSlot` for the manual-job intake window.
- `prisma/job-payment-receipts-migration.sql` adds immutable local job receipt snapshots. Apply it before deploying the receipt endpoints.
- `prisma/job-removal-audit-migration.sql` adds the durable audit table for the Admin dispatched-job removal flow. Apply it before deploying that flow.
- `prisma/job-dual-pricing-migration.sql` adds nullable versioned dual-price quote and acceptance fields to invoices. Apply it before deploying the pending-card quote UI/API; legacy rows remain `NULL` and keep their prior interpretation.
- `prisma/locksmith-business-identity-migration.sql` updates the Locksmith Books entity to Better Call Locksmith Inc. and the business-supplied Spadina address. Existing issued receipt and invoice snapshots are unchanged.
- `prisma/locksmith-hst-registration-migration.sql` updates only the Locksmith Books entity with the business-supplied HST number and effective date. Apply it after the Locksmith Books entity exists.

These migrations are additive and preserve existing job business data. Existing rows receive a migration-time default for the new non-null `updatedAt` column, while existing `jobReceivedTimeSlot` values remain `NULL` until a manual job is edited or recorded with a time window. Verify both columns exist before serving the new application build.

Required production environment variables:

```env
POSTGRES_PRISMA_URL="..."
POSTGRES_URL_NON_POOLING="..."
ADMIN_PASSWORD="a-strong-admin-password"
NEXT_PUBLIC_APP_URL="https://your-domain.example"
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
# Optional account pin; when set, Stripe receipt requests must match this account.
LOCKSMITH_STRIPE_ACCOUNT_ID="acct_..."
# Set true only after Locksmith's payment processor and accountant approve the dual-price presentation and HST treatment.
LOCKSMITH_DUAL_PRICING_APPROVED="false"
# Optional for the current hosted Checkout redirect:
STRIPE_PUBLISHABLE_KEY="pk_live_..."
```

Job receipts are limited to Admin and Dispatcher users. Verify the `LOCKSMITH` accounting entity has the legal name `Better Call Locksmith Inc.`, corporation number `1001348245`, address `222 Spadina Avenue, Unit 114, Toronto, Ontario M5T 3B3, Canada`, HST number `702291725RT0001`, HST enabled, and effective date `2026-01-01`. Apply the Locksmith HST migration and the Locksmith business identity migration to an existing database; seed/default changes do not update an existing row. New dual-price Stripe documents check the live account's legal name, address, and HST ID against this entity; set `LOCKSMITH_STRIPE_ACCOUNT_ID` to pin the expected account for all Stripe document lookups when available. The Stripe account's business name, address, and HST configuration must match before new dual-price Stripe receipt/invoice documents can be retrieved. Historical Stripe receipts and invoice PDFs are retrieved as the original documents Stripe issued; the portal does not rewrite them or reject them based on current issuer settings. Previously issued local receipt snapshots remain unchanged; newly generated local receipts use the updated issuer details and require a payment date on or after the HST effective date. New dual-price document requests fail closed when issuer configuration is incomplete or mismatched. Do not use the IT Marketing HST number.

New pending-card manual quotes use `DUAL_PRICE_V1`: both the lower non-card price and the higher card price are stored, with dispatcher-entered customer acceptance evidence. Stripe Checkout receives only the accepted card service price and calculates tax; the portal does not add a card/admin fee line. Keep `LOCKSMITH_DUAL_PRICING_APPROVED=false` until the processor and accountant review the presentation and HST treatment. The quote form shows Ontario tax-inclusive estimates; Stripe Checkout must show its final billing-location tax total before card authorization. Existing legacy invoice rows with no pricing model are not silently converted; re-quote them before creating a new payment link. Previously paid Stripe jobs continue to expose Stripe's original hosted receipt and paid invoice without rewriting the issued document. Apply `prisma/job-dual-pricing-migration.sql` before deployment.

Configure the Stripe webhook to deliver `charge.refunded` so fully refunded Stripe payments lose receipt eligibility. Partial refunds remain linked to Stripe's original document and should be reconciled with the customer separately.

`ADMIN_PASSWORD` is used only for the built-in Admin login. Staff accounts created from the Admin console receive their own password hash. Do not use the development fallback password in production.

### Google Ads ROI setup

The Admin dashboard pulls Google Ads spend for the selected period when the Admin dashboard loads and when an Admin clicks **Sync today**, **Sync yesterday**, **Sync last week**, **Sync this biweekly period**, **Sync previous biweekly period**, or **Sync all time**. Spend is cached in `GoogleAdsDailyMetric`. The ROI widget supports these Toronto calendar periods: Today, Yesterday, the trailing seven days, the current anchored 14-day partner billing period, the previous anchored 14-day partner billing period, and All time beginning September 7, 2026, when the company started. It compares spend with net profit, not revenue. Net profit uses the existing accounting definition: paid gross invoices minus HST, technician commissions, and parts cost. The default **ROI for partner** view splits that profit equally between the two partners before calculating ROI; **ROI for company** uses the full company profit.

Google Ads does not use a single API key for this integration. Google requires an OAuth 2.0 client and a Google Ads developer token. The account customer ID is also required. See Google’s official [authorization and HTTP headers guide](https://developers.google.com/google-ads/api/rest/auth).

Add these server-only variables to Vercel and local development as needed:

```env
GOOGLE_ADS_DEVELOPER_TOKEN="..."
GOOGLE_ADS_CLIENT_ID="...apps.googleusercontent.com"
GOOGLE_ADS_CLIENT_SECRET="..."
# Optional legacy/bootstrap token. Admins can connect or reconnect from the dashboard.
GOOGLE_ADS_REFRESH_TOKEN="..."
GOOGLE_ADS_CUSTOMER_ID="1234567890"

# Required to encrypt OAuth refresh tokens stored in the database.
# Generate once with: openssl rand -base64 32
# Keep the same value across deploys; changing it makes stored tokens unreadable.
GOOGLE_ADS_TOKEN_ENCRYPTION_KEY="..."

# Required only when the OAuth user reaches the account through a manager account.
GOOGLE_ADS_LOGIN_CUSTOMER_ID="0987654321"

# Optional; defaults to CAD for display and v25 for the Google Ads REST endpoint.
GOOGLE_ADS_CURRENCY_CODE="CAD"
GOOGLE_ADS_API_VERSION="v25"
```

To obtain the values:

1. In Google Ads, create or use a Manager account and open **Admin → API Center**. Copy the developer token. Google documents that a developer token is required on every API request and that its access level controls production access.
2. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project, enable the Google Ads API, configure the OAuth consent screen, and create a **Web application** OAuth client ID. Keep the client secret private.
3. Make sure the OAuth consent screen is in production. After deploying, an Admin will use **Connect / reconnect Google Ads** in the dashboard to authorize the Ads account with the `https://www.googleapis.com/auth/adwords` scope and offline access. Google’s [single-user authentication guide](https://developers.google.com/google-ads/api/docs/oauth/single-user-authentication) describes the flow.
4. Copy the 10-digit client account ID from Google Ads into `GOOGLE_ADS_CUSTOMER_ID`, removing hyphens. If the authorized Google user enters the account through a Manager account, put that Manager ID, also without hyphens, in `GOOGLE_ADS_LOGIN_CUSTOMER_ID`; otherwise leave it unset.
5. Apply `prisma/google-ads-daily-metric-migration.sql` and `prisma/google-ads-oauth-credential-migration.sql` once to an existing production database, or run `npx prisma db push` for a new database, before deploying the code.
6. Add `https://YOUR_APP_DOMAIN/api/owner/google-ads/callback` as an authorized redirect URI on the OAuth web client. The Google Ads page’s **Reconnect** button uses this callback to save the refresh token securely. Keep the OAuth consent screen in production; testing-mode refresh tokens expire after seven days for the Ads scope.

7. Set `GOOGLE_ADS_CURRENCY_CODE` and `GOOGLE_ADS_TIME_ZONE` to the values shown in the Google Ads account (Admin → Billing/Settings), then `GOOGLE_ADS_METADATA_VERIFIED=true`. Until all three are set, the Google Ads page and Dashboard card deliberately show no spend figures instead of assuming CAD/Toronto.

If Google Ads access expires or is revoked (`invalid_grant`), click **Reconnect** on the Admin **Google Ads** page and sign in again. The callback stores the new refresh token encrypted in the database, so no environment-variable edit or redeploy is needed. A revoked token still requires a Google sign-in and consent; it cannot be renewed silently.

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
   - `STRIPE_SECRET_KEY`: server-side Stripe key for creating Checkout Sessions
   - `STRIPE_WEBHOOK_SECRET`: webhook endpoint signing secret
   - `STRIPE_PUBLISHABLE_KEY`: optional for the current hosted redirect; reserved for future Stripe.js flows
5. Click **"Deploy"**.

Vercel will run `prisma generate && next build` automatically. Within 60 seconds, your application will be live with a secure HTTPS URL!

---

## 🔒 Production Webhook Configuration

### Stripe Webhook (Payment Status and Invoice Tracking)
1. Go to **Stripe Dashboard** ➔ **Developers** ➔ **Webhooks**.
2. Add an endpoint pointing to:
   `https://your-app.vercel.app/api/webhooks/stripe`
3. Select these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `invoice.sent`
   - `charge.refunded`
4. Copy the Signing Secret into Vercel as `STRIPE_WEBHOOK_SECRET`.
5. Enable **Stripe Tax** and configure the business address and Ontario tax
   registration in Stripe Tax settings. New manual card quotes use the
   accepted card price as one taxable service line; Stripe calculates the
   final tax from the customer's billing address. No separate card/admin fee
   line is added to the new dual-price invoice.

For local testing, use the Stripe CLI instead of a Dashboard endpoint:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the `whsec_...` value printed by the CLI into local `.env`. The CLI
secret and a Dashboard endpoint secret are different and must not be mixed.

Pending Credit Card/Debit Card manual jobs create a hosted Checkout Session
after the customer has accepted the disclosed card price. For example, a $100
non-card price and 4% price difference are stored as $100 and $104 before tax;
the Stripe invoice contains the accepted $104 service line, with tax calculated
by Stripe. The portal does not represent the difference as a separate card or
admin fee.
The customer enters their email on Stripe Checkout. Stripe then creates and
sends the paid invoice after successful payment. The application updates its
invoice only from verified Stripe webhooks, not from the success redirect.

### Device SMS
- The portal prepares an `sms:` link and message preview for the dispatcher or technician.
- The user must review the draft, open the native Messages app, and tap Send. The portal cannot verify delivery.
- No Twilio credentials are required or used by active job routes.

### Revenue email
- Manual-job creation, manual revenue edits, normal job completion, and abandoned-job travel-fee closeout send an accounting summary through Resend to `mail2mws@gmail.com`.
- Email delivery failure does not roll back the job or revenue mutation; the API response includes `revenueEmail.success` and an error when available.
