-- Add the optional two-hour intake window for manually recorded completed jobs.
-- Existing jobs remain unchanged and receive NULL until edited.
ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "jobReceivedTimeSlot" TEXT;
