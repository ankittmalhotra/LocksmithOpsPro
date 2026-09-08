-- Run this only if the original schema already exists and you are not using
-- supabase-fresh-reset.sql.

begin;

alter table "User"
  add column if not exists "commissionRate" double precision not null default 0.0;

alter table "Job"
  add column if not exists "workerCommissionRate" double precision not null default 0.0;

commit;
