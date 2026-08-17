-- Device.timezone becomes mandatory: required at both create and claim
-- time from now on (see the createSchema/claimSchema changes in
-- src/admin/devices.ts), since it's load-bearing for both accurate
-- punch-time conversion and the ADMS handshake TimeZone= fix. Backfill
-- any existing NULL rows to Asia/Kolkata (this deployment's primary
-- operating timezone) before enforcing NOT NULL - admins can change it
-- per device afterward if a particular one is actually in a different zone.
UPDATE "devices"
SET "timezone" = 'Asia/Kolkata'
WHERE "timezone" IS NULL;

ALTER TABLE "devices" ALTER COLUMN "timezone" SET NOT NULL;
