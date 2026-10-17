import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, TableParams } from "../api";

export interface SortState {
  sortBy: string;
  sortDir: "asc" | "desc";
}

type FetchParams = Required<Pick<TableParams, "page" | "pageSize">> & TableParams;

interface Options<T> {
  fetcher: (params: FetchParams) => Promise<{ rows: T[]; total: number }>;
  // Initial sort, shown as the active header arrow. Must match what the
  // server falls back to when no sortBy is sent, so the arrow tells the truth.
  defaultSort: SortState;
  pageSize?: number;
  // Anything else the query depends on (filters). A change resets to page 1.
  deps?: unknown[];
  // Skip fetching entirely (e.g. Raw Data Dump before a device is chosen).
  enabled?: boolean;
  errorMessage: string;
}

const SEARCH_DEBOUNCE_MS = 300;

// Server-side datatable state: page / page size / sort / debounced search,
// all sent to the backend - rows are never sorted or filtered client-side.
export function useDataTable<T>({
  fetcher,
  defaultSort,
  pageSize: initialPageSize = 25,
  deps = [],
  enabled = true,
  errorMessage,
}: Options<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [sort, setSort] = useState<SortState>(defaultSort);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  // The latest fetcher, read at call time so callers can pass an inline
  // closure over their own filter state without retriggering the effect.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Responses that arrive after a newer request was issued are dropped.
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch((prev) => {
        const next = searchInput.trim();
        if (next !== prev) setPage(1);
        return next;
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const depsKey = JSON.stringify(deps);
  const firstDepsRun = useRef(true);
  useEffect(() => {
    if (firstDepsRun.current) {
      firstDepsRun.current = false;
      return;
    }
    setPage(1);
  }, [depsKey]);

  const load = useCallback(async () => {
    if (!enabled) {
      requestId.current++;
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await fetcherRef.current({
        page,
        pageSize,
        sortBy: sort.sortBy,
        sortDir: sort.sortDir,
        search: search || undefined,
      });
      if (id !== requestId.current) return;
      setRows(result.rows);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof ApiError ? err.message : errorMessage);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, page, pageSize, sort.sortBy, sort.sortDir, search, depsKey]);

  useEffect(() => {
    load();
  }, [load]);

  // Clicking a header: first click sorts ascending, second descending;
  // switching to another column starts ascending again.
  function toggleSort(key: string) {
    setSort((s) =>
      s.sortBy === key ? { sortBy: key, sortDir: s.sortDir === "asc" ? "desc" : "asc" } : { sortBy: key, sortDir: "asc" }
    );
    setPage(1);
  }

  function setPageSize(size: number) {
    setPageSizeState(size);
    setPage(1);
  }

  return {
    rows,
    total,
    page,
    pageSize,
    sort,
    searchInput,
    loading,
    error,
    setError,
    setPage,
    setPageSize,
    setSearchInput,
    toggleSort,
    reload: load,
  };
}
