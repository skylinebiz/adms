// Client-side convenience only - suggests a slug from a name as the user
// types. Server-side validation (slugSchema in src/utils/slug.ts) is the
// real source of truth for what's accepted.
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
