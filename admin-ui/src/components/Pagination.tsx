interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  // When given, shows a "rows per page" picker.
  onPageSizeChange?: (pageSize: number) => void;
}

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="pagination">
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {totalPages} ({onPageSizeChange ? `${first}–${last} of ${total}` : `${total} total`})
      </span>
      <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
      {onPageSizeChange && (
        <label className="pagination-size">
          Rows per page
          <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
