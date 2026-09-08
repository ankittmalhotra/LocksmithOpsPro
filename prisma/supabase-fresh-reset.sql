-- WARNING: DESTRUCTIVE RESET
-- Run this manually in the Supabase SQL Editor.
-- This deletes all existing tables, data, and custom types in the public schema.

begin;

drop schema if exists public cascade;
create schema public;
grant all on schema public to postgres;
grant all on schema public to public;

create extension if not exists pgcrypto;

create type "Role" as enum ('ADMIN', 'DISPATCHER', 'TECHNICIAN');
create type "JobStatus" as enum (
  'NEW',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'ABANDONED_TRAVEL_FEE',
  'INVOICED',
  'COMPLETED',
  'CANCELLED'
);
create type "PaymentMethod" as enum ('CASH', 'INTERAC', 'STRIPE_CARD', 'DEBIT_CARD', 'CREDIT_CARD');
create type "PaymentStatus" as enum ('PENDING', 'PAID', 'REFUNDED');
create type "SettlementStatus" as enum ('UNSETTLED', 'SETTLED');

create table "User" (
  "id" text primary key default gen_random_uuid()::text,
  "name" text not null,
  "phone" text not null unique,
  "email" text unique,
  "passwordHash" text,
  "role" "Role" not null default 'TECHNICIAN',
  "active" boolean not null default true,
  "commissionRate" double precision not null default 0.0,
  "createdAt" timestamp(3) not null default current_timestamp
);

create table "Customer" (
  "id" text primary key default gen_random_uuid()::text,
  "name" text not null,
  "phone" text not null,
  "extension" text,
  "address" text not null,
  "unit" text,
  "postalCode" text,
  "notes" text,
  "createdAt" timestamp(3) not null default current_timestamp
);

create table "Job" (
  "id" text primary key default gen_random_uuid()::text,
  "jobNumber" integer not null unique,
  "customerId" text not null,
  "dispatcherId" text not null,
  "technicianId" text,
  "status" "JobStatus" not null default 'NEW',
  "isManual" boolean not null default false,
  "serviceType" text not null,
  "problemDescription" text not null,
  "serviceAddress" text not null,
  "workerCommissionRate" double precision not null default 0.0,
  "workerCommission" double precision not null default 0.0,
  "isAbandoned" boolean not null default false,
  "travelFeeAmount" double precision,
  "keyBitting" text,
  "doorDetails" text,
  "proofPhotoUrl" text,
  "preWorkSignature" text,
  "customerSignature" text,
  "vehicleYear" text,
  "vehicleMake" text,
  "vehicleModel" text,
  "vehicleVin" text,
  "keyType" text,
  "fccId" text,
  "isScheduled" boolean not null default false,
  "scheduledFor" timestamp(3),
  "createdAt" timestamp(3) not null default current_timestamp,
  "dispatchedAt" timestamp(3),
  "completedAt" timestamp(3),
  constraint "Job_customerId_fkey"
    foreign key ("customerId") references "Customer"("id") on delete restrict on update cascade,
  constraint "Job_dispatcherId_fkey"
    foreign key ("dispatcherId") references "User"("id") on delete restrict on update cascade,
  constraint "Job_technicianId_fkey"
    foreign key ("technicianId") references "User"("id") on delete set null on update cascade
);

create table "JobItem" (
  "id" text primary key default gen_random_uuid()::text,
  "jobId" text not null,
  "description" text not null,
  "quantity" integer not null default 1,
  "unitCost" double precision not null default 0.0,
  "unitPrice" double precision not null default 0.0,
  "isPart" boolean not null default true,
  constraint "JobItem_jobId_fkey"
    foreign key ("jobId") references "Job"("id") on delete cascade on update cascade
);

create table "Invoice" (
  "id" text primary key default gen_random_uuid()::text,
  "jobId" text not null unique,
  "calculationMode" text not null default 'FORWARD',
  "subtotal" double precision not null,
  "partsTotal" double precision not null default 0.0,
  "laborTotal" double precision not null default 0.0,
  "taxRate" double precision not null default 0.13,
  "taxAmount" double precision not null default 0.0,
  "cardSurchargeRate" double precision not null default 0.024,
  "cardSurchargeAmount" double precision not null default 0.0,
  "grandTotal" double precision not null,
  "totalAmountCollected" double precision not null default 0.0,
  "taxCollected" boolean not null default true,
  "cogsAmount" double precision not null default 0.0,
  "paymentStatus" "PaymentStatus" not null default 'PENDING',
  "paymentMethod" "PaymentMethod",
  "cashOwedToCompany" double precision not null default 0.0,
  "settlementStatus" "SettlementStatus" not null default 'UNSETTLED',
  "smsSent" boolean not null default false,
  "stripeSessionId" text,
  "stripePaymentUrl" text,
  "paidAt" timestamp(3),
  "createdAt" timestamp(3) not null default current_timestamp,
  constraint "Invoice_jobId_fkey"
    foreign key ("jobId") references "Job"("id") on delete cascade on update cascade
);

create table "Settlement" (
  "id" text primary key default gen_random_uuid()::text,
  "technicianId" text not null,
  "amountSettled" double precision not null,
  "paymentMethod" text not null,
  "notes" text,
  "settledBy" text not null,
  "settledAt" timestamp(3) not null default current_timestamp,
  constraint "Settlement_technicianId_fkey"
    foreign key ("technicianId") references "User"("id") on delete restrict on update cascade
);

create index "Job_customerId_idx" on "Job"("customerId");
create index "Job_dispatcherId_idx" on "Job"("dispatcherId");
create index "Job_technicianId_idx" on "Job"("technicianId");
create index "Job_status_idx" on "Job"("status");
create index "JobItem_jobId_idx" on "JobItem"("jobId");
create index "Settlement_technicianId_idx" on "Settlement"("technicianId");

-- Initial login account. Run prisma/seed.js with ADMIN_PASSWORD after this
-- reset so the Admin account receives a password hash.
insert into "User" ("id", "name", "phone", "email", "role", "active")
values (
  'super-admin-root',
  'Administrator',
  '0000000000',
  'admin@locksmithops.com',
  'ADMIN',
  true
);

commit;
