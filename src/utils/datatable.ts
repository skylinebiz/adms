import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

// Shared server-side "datatable" query contract used by every admin list
// endpoint: ?page=&pageSize=&sortBy=&sortDir=&search=. Each endpoint
// declares which columns are sortable/searchable (see buildOrderBy and
// buildSearch below); anything else is ignored rather than passed through
// to the database, so a client can never sort or search on a column that
// has no index behind it.

export type SortDir = "asc" | "desc";

export const dataTableQuerySchema = paginationQuerySchema.extend({
  sortBy: z.string().max(50).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  search: z.string().trim().max(100).optional(),
});

// Maps a sortBy key (the column key the UI sends) to a Prisma orderBy
// fragment for the given direction.
export type SortColumns<O> = Record<string, (dir: SortDir) => O>;

// Unknown/absent sortBy falls back to `fallback`. A trailing `id`
// tiebreaker is always appended so pagination is stable when the sorted
// column has duplicate values (otherwise rows can repeat or vanish across
// pages).
export function buildOrderBy<O>(
  sortBy: string | undefined,
  sortDir: SortDir | undefined,
  columns: SortColumns<O>,
  fallback: O[]
): (O | { id: SortDir })[] {
  const column = sortBy && Object.prototype.hasOwnProperty.call(columns, sortBy) ? columns[sortBy] : undefined;
  if (!column) return [...fallback, { id: "desc" }];
  const dir: SortDir = sortDir ?? "asc";
  return [column(dir), { id: dir }];
}

// Case-insensitive "contains" match across the given scalar fields.
// Returns undefined (no filter) for an empty search. Each entry is a
// function so nested relation paths (e.g. device.serialNumber) can be
// expressed.
export function buildSearch<W>(
  search: string | undefined,
  fields: ((term: { contains: string; mode: "insensitive" }) => W)[]
): { OR: W[] } | undefined {
  if (!search) return undefined;
  const term = { contains: search, mode: "insensitive" as const };
  return { OR: fields.map((f) => f(term)) };
}

// NULLs last regardless of direction, for nullable columns like
// Device.lastSeenAt where "never" shouldn't float to the top of a
// descending sort.
export function nullsLast(dir: SortDir) {
  return { sort: dir, nulls: "last" as const };
}
