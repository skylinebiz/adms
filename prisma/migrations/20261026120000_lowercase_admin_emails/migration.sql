-- Emails are now trimmed and lowercased on signup/create/login, so a stored
-- mixed-case address could never be matched again. Normalize existing rows,
-- skipping any whose lowercase form already belongs to another account (two
-- accounts differing only by case) so the unique constraint is never
-- violated; those few need a manual decision.
UPDATE "AdminUser" a
SET "email" = lower(btrim(a."email"))
WHERE a."email" <> lower(btrim(a."email"))
  AND NOT EXISTS (
    SELECT 1 FROM "AdminUser" b
    WHERE b."id" <> a."id" AND lower(btrim(b."email")) = lower(btrim(a."email"))
  );
