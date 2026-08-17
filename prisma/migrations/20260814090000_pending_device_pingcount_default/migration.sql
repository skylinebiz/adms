-- upsertPendingDevice now always creates a PendingDevice row at pingCount 0
-- then immediately bumps it to 1 in the same call (compare-and-set rewrite
-- to fix a TOCTOU race) - the old DEFAULT 1 was never actually consulted
-- by application code. No data changes; existing rows are unaffected.
ALTER TABLE "pending_devices" ALTER COLUMN "pingCount" SET DEFAULT 0;
