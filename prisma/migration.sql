-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'OWNER', 'DISPATCHER', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'ABANDONED_TRAVEL_FEE', 'INVOICED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'INTERAC', 'STRIPE_CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('UNSETTLED', 'SETTLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "role" "Role" NOT NULL DEFAULT 'TECHNICIAN',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "extension" TEXT,
    "address" TEXT NOT NULL,
    "unit" TEXT,
    "postalCode" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "jobNumber" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "dispatcherId" TEXT NOT NULL,
    "technicianId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'NEW',
    "serviceType" TEXT NOT NULL,
    "problemDescription" TEXT NOT NULL,
    "serviceAddress" TEXT NOT NULL,
    "workerCommissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "workerCommission" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isAbandoned" BOOLEAN NOT NULL DEFAULT false,
    "travelFeeAmount" DOUBLE PRECISION,
    "keyBitting" TEXT,
    "doorDetails" TEXT,
    "proofPhotoUrl" TEXT,
    "customerSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isPart" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "JobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "calculationMode" TEXT NOT NULL DEFAULT 'FORWARD',
    "subtotal" DOUBLE PRECISION NOT NULL,
    "partsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "laborTotal" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.13,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "cardSurchargeRate" DOUBLE PRECISION NOT NULL DEFAULT 0.04,
    "cardSurchargeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "grandTotal" DOUBLE PRECISION NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "PaymentMethod",
    "cashOwedToCompany" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'UNSETTLED',
    "smsSent" BOOLEAN NOT NULL DEFAULT false,
    "stripeSessionId" TEXT,
    "stripePaymentUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "amountSettled" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "notes" TEXT,
    "settledBy" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Job_jobNumber_key" ON "Job"("jobNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_jobId_key" ON "Invoice"("jobId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_dispatcherId_fkey" FOREIGN KEY ("dispatcherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobItem" ADD CONSTRAINT "JobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Initial admin only. Login is admin / admin123.
INSERT INTO "User" ("id", "name", "phone", "email", "role", "active", "commissionRate")
VALUES ('super-admin-root', 'Administrator', '0000000000', 'admin@locksmithops.com', 'SUPER_ADMIN', true, 0)
ON CONFLICT ("phone") DO NOTHING;

-- Phase 2 & 3 Additive Columns
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "preWorkSignature" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "vehicleYear" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "vehicleMake" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "vehicleModel" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "vehicleVin" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "keyType" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "fccId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "isScheduled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMP(3);

