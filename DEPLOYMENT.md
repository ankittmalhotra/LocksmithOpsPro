# Deployment Guide: Free Hosting on Vercel & Supabase

This project is tailored specifically for **Vercel** (Frontend & Serverless API) and **Supabase** (Managed PostgreSQL Database). For low-to-medium operational volume, **this entire stack runs 100% free of charge**.

---

## 💰 Free Tier Breakdown

| Provider | Free Tier Allowance | Fits Locksmith Operations? |
| :--- | :--- | :--- |
| **Vercel (Hobby)** | • Unlimited deployments<br>• Automated CI/CD from GitHub<br>• Free custom domain & SSL HTTPS<br>• 100 GB bandwidth / mo<br>• Fast Edge CDN | **Yes, 100% Free**. Operators, technicians, and owners can access the system with zero hosting fees. |
| **Supabase (Free Tier)** | • 500 MB PostgreSQL Database<br>• 50,000 Monthly Active Users<br>• Supavisor Connection Pooling (Port 6543)<br>• Daily backups | **Yes, 100% Free**. 500 MB easily stores over **100,000+ locksmith jobs**, invoices, and customer records. |

---

## 🚀 5-Step Deployment Walkthrough

### Step 1: Create a Free Supabase Database
1. Go to [supabase.com](https://supabase.com) and create a free account.
2. Click **"New Project"**, name it (e.g. `locksmith-operations`), and set a strong database password.
3. Select the region closest to your operations (e.g., `East US (N. Virginia)` or `Central Canada`).
4. Once the project is provisioned, go to **Project Settings** (gear icon) ➔ **Database** ➔ **Connection string**.
5. Copy two URLs:
   - **Transaction Pooler (Port 6543)** with Mode `Transaction` (this is your `DATABASE_URL`).
   - **Direct Connection (Port 5432)** with Mode `Session` (this is your `DIRECT_URL`).

---

### Step 2: Configure Prisma for PostgreSQL
In `prisma/schema.prisma`, update the datasource block to:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

Create your local `.env` file with these values:
```env
DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
```

---

### Step 3: Push Schema and Seed Database
Run the following commands in your terminal to initialize tables and load initial data on Supabase:

```bash
# Push the schema to your Supabase PostgreSQL database
npx prisma db push

# Populate initial users (Owner, Dispatcher, Techs) & Toronto sample jobs
node prisma/seed.js
```

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
   - `DATABASE_URL`: *(Your Supabase pooled connection string from Step 1)*
   - `DIRECT_URL`: *(Your Supabase direct connection string from Step 1)*
   - `NEXT_PUBLIC_APP_URL`: `https://your-project-name.vercel.app` *(or your custom domain)*
   - *(Optional)* `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
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

### Twilio Messaging
- When you add your Twilio credentials to Vercel, SMS dispatch alerts to contractors and payment links to clients will be transmitted live via your Twilio phone number.
