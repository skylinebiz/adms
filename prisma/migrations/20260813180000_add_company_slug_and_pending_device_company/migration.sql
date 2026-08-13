-- Public self-signup: every company now has a URL-safe, globally unique
-- slug used as the first path segment in a device's Cloud Server URL
-- (/<slug>/<deviceSecret>/iclock/...) and as the pending-device company
-- scope. Backfill existing rows with a slugified name + id suffix to
-- guarantee uniqueness before the column is made NOT NULL.
ALTER TABLE "companies" ADD COLUMN "slug" TEXT;

UPDATE "companies"
SET "slug" = COALESCE(
  NULLIF(lower(regexp_replace(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g')), ''),
  'company'
) || '-' || lower(right("id", 6))
WHERE "slug" IS NULL;

ALTER TABLE "companies" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- Pending (not-yet-claimed) device pings become company-scoped: nullable
-- because legacy /iclock pings and typo'd/unresolved slugs still land in
-- the existing global/unscoped bucket. ON DELETE CASCADE so deleting a
-- company also clears any pending devices already attributed to it.
ALTER TABLE "pending_devices" ADD COLUMN "companyId" TEXT;
ALTER TABLE "pending_devices" ADD CONSTRAINT "pending_devices_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "pending_devices_companyId_idx" ON "pending_devices"("companyId");
