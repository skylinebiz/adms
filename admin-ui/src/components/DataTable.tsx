import { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Pagination from "./Pagination";
import type { SortState } from "../hooks/useDataTable";

export interface Column<T> {
  key: string;
  header: ReactNode;
  // Hover text on the header (explains what the column means).
  title?: string;
  // Sorting is opt-in: a column is sortable only if the backend has an
  // indexed sort for this exact key (see the sortColumns maps in src/admin).
  sortable?: boolean;
  render: (row: T) => ReactNode;
  cellClassName?: string;
  cellStyle?: CSSProperties;
}

export interface Selection {
  selected: Set<string>;
  toggle: (id: string) => void;
  toggleAll: (ids: string[]) => void;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading: boolean;
  sort: SortState;
  onSort: (key: string) => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  emptyMessage: ReactNode;
  // Search box above the table; omit to hide it.
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  // Extra controls rendered beside the search box.
  toolbar?: ReactNode;
  selection?: Selection;
  hidePagination?: boolean;
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  sort,
  onSort,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  emptyMessage,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
  toolbar,
  selection,
  hidePagination,
}: Props<T>) {
  const colCount = columns.length + (selection ? 1 : 0);
  const ids = rows.map(rowKey);

  return (
    <>
      {(onSearchChange || toolbar) && (
        <div className="datatable-toolbar">
          {onSearchChange && (
            <input
              type="search"
              className="datatable-search"
              placeholder={searchPlaceholder}
              aria-label="Search"
              value={searchValue ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          )}
          {toolbar}
        </div>
      )}
      <div className={`table-wrap${loading ? " is-loading" : ""}`} aria-busy={loading}>
        <table>
          <thead>
            <tr>
              {selection && (
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={rows.length > 0 && ids.every((id) => selection.selected.has(id))}
                    onChange={() => selection.toggleAll(ids)}
                  />
                </th>
              )}
              {columns.map((col) => {
                const active = col.sortable && sort.sortBy === col.key;
                return (
                  <th
                    key={col.key}
                    title={col.title}
                    aria-sort={active ? (sort.sortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {col.sortable ? (
                      <button type="button" className={`sort-btn${active ? " active" : ""}`} onClick={() => onSort(col.key)}>
                        {col.header}
                        {active ? (
                          sort.sortDir === "asc" ? (
                            <ArrowUp size={12} aria-hidden />
                          ) : (
                            <ArrowDown size={12} aria-hidden />
                          )
                        ) : (
                          <ArrowUpDown size={12} aria-hidden className="sort-idle" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = rowKey(row);
              return (
                <tr key={id}>
                  {selection && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={selection.selected.has(id)}
                        onChange={() => selection.toggle(id)}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={col.cellClassName} style={col.cellStyle}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="muted empty-cell">
                  {loading ? "Loading…" : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!hidePagination && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </>
  );
}
