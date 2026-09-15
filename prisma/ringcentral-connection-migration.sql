-- Additive migration for the shared RingCentral OAuth connection.
-- Run once against the production database before using OAuth Connect so
-- Admin and Dispatcher dashboards share the connection.
CREATE TABLE IF NOT EXISTS "RingCentralConnection" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "encryptedTokenData" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RingCentralConnection_pkey" PRIMARY KEY ("id")
);
