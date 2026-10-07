-- Backfill missing labels with the device's serial number.
UPDATE "devices" SET "label" = "serialNumber" WHERE "label" IS NULL OR TRIM("label") = '';
