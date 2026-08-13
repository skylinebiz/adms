ALTER TABLE "devices" ADD COLUMN "timezone" TEXT;

ALTER TABLE "punch_records" ADD COLUMN "punchTimeUtc" TIMESTAMP(3);
