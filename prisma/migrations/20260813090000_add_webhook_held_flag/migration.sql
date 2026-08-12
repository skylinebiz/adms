-- True when a punch was ingested while its device had no webhook configured.
-- Held records are excluded from automatic worker pickup even after a
-- webhook is configured later; only new punches or an explicit retry
-- (which clears this flag) become eligible.
ALTER TABLE "punch_records" ADD COLUMN "webhookHeld" BOOLEAN NOT NULL DEFAULT false;
