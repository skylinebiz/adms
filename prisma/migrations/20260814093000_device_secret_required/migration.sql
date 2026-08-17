-- deviceSecret becomes mandatory: every device-facing URL now requires a
-- secret path segment structurally (there's no bare/legacy /iclock path
-- left), so every Device row should have one too. Backfill any existing
-- NULL rows with a random value before enforcing NOT NULL - these are
-- devices that were previously "open on the legacy URL" and will need
-- reconfiguring with the generated value (visible in the admin panel's
-- device edit drawer immediately after this migration runs).
UPDATE "devices"
SET "deviceSecret" = md5(random()::text || clock_timestamp()::text || "id")
WHERE "deviceSecret" IS NULL;

ALTER TABLE "devices" ALTER COLUMN "deviceSecret" SET NOT NULL;
