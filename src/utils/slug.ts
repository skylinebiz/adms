import { z } from "zod";

// Reserved top-level path segments that can never be claimed as a company
// slug - the same reserved-word concept previously guarding the device
// secret segment (src/adms/router.ts's old RESERVED_SECRET_VALUES), now
// applied to the company-slug segment instead. A real company can never be
// created with one of these (enforced here at signup/company-create time),
// so the routing guard that also checks this set is belt-and-suspenders.
export const RESERVED_SLUG_VALUES = new Set(["admin", "api", "health"]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlugFormat(slug: string): boolean {
  return (
    slug.length >= 3 &&
    slug.length <= 63 &&
    SLUG_PATTERN.test(slug) &&
    !RESERVED_SLUG_VALUES.has(slug)
  );
}

export const slugSchema = z
  .string()
  .min(3)
  .max(63)
  .refine(isValidSlugFormat, {
    message:
      'Slug must be lowercase letters, digits, and hyphens (no leading/trailing/double hyphens), 3-63 characters, and not a reserved word ("admin", "api", "health")',
  });
