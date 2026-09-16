-- Additive migration for on-demand Google Ads daily spend caching.
-- Safe to run more than once against an existing PostgreSQL database.
CREATE TABLE IF NOT EXISTS "GoogleAdsDailyMetric" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "conversionsValue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleAdsDailyMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GoogleAdsDailyMetric_customerId_date_key"
  ON "GoogleAdsDailyMetric" ("customerId", "date");

CREATE INDEX IF NOT EXISTS "GoogleAdsDailyMetric_date_idx"
  ON "GoogleAdsDailyMetric" ("date");
