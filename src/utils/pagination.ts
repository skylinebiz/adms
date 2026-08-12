import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Cap for lightweight "/options" endpoints that feed <select> dropdowns.
// These are intentionally unpaginated (a dropdown needs the whole set to be
// useful) but still bounded so a tenant with a very large number of rows
// can't return an unbounded payload.
export const OPTIONS_LIMIT = 500;
