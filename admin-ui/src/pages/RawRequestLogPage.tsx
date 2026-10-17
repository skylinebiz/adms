import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, RawRequestLog } from "../api";
import { useSelection } from "../hooks/useSelection";
import { useDataTable } from "../hooks/useDataTable";
import DataTable, { Column } from "../components/DataTable";
import RawEntryDrawer from "../components/RawEntryDrawer";
import { formatDateTime } from "../utils/dateFormat";
import { Eye, Trash2 } from "lucide-react";
import IconButton from "../components/IconButton";

export default function RawRequestLogPage() {
  const [params, setParams] = useSearchParams();
  const [actionError, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<RawRequestLog | null>(null);
  const { selected, toggle, toggleAll, clear } = useSelection();

  const endpoint = params.get("endpoint") ?? "";

  const table = useDataTable<RawRequestLog>({
    fetcher: async (q) => {
      const result = await api.listRawRequests({ ...q, endpoint: endpoint || undefined });
      return { rows: result.requests, total: result.total };
    },
    defaultSort: { sortBy: "createdAt", sortDir: "desc" },
    deps: [endpoint],
    errorMessage: "Failed to load raw request log",
  });
  const error = actionError ?? table.error;
  const load = table.reload;

  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.rows]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this raw request entry? This cannot be undone.")) return;
    try {
      await api.deleteRawRequest(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} raw request entr${selected.size === 1 ? "y" : "ies"}? This cannot be undone.`)) return;
    try {
      await api.deleteRawRequestsBulk(Array.from(selected));
      clear();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  const columns: Column<RawRequestLog>[] = [
    { key: "createdAt", header: "Received", sortable: true, render: (r) => formatDateTime(r.createdAt) },
    {
      key: "serialNumber",
      header: "SN",
      sortable: true,
      render: (r) =>
        r.serialNumber ? <code className="mono">{r.serialNumber}</code> : <span className="muted">(missing)</span>,
    },
    { key: "method", header: "Method", render: (r) => r.method },
    {
      key: "endpoint",
      header: "Endpoint",
      sortable: true,
      render: (r) => <code className="mono">{r.endpoint}</code>,
    },
    { key: "bodySize", header: "Body size", render: (r) => `${r.rawBody?.length ?? 0} chars` },
    {
      key: "actions",
      header: "",
      cellClassName: "actions-cell",
      render: (r) => (
        <>
          <IconButton icon={Eye} label="View" onClick={() => setViewing(r)} />
          <IconButton icon={Trash2} label="Delete" variant="danger" onClick={() => deleteOne(r.id)} />
        </>
      ),
    },
  ];

  return (
    <div>
      <h2>Raw Request Log</h2>
      <p className="muted">
        Every single request that hits /iclock/*, unfiltered - registered or not, any table, including heartbeats.
        This is the platform-wide firehose for low-level protocol debugging. Super admin only.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="filters">
        <div className="field">
          <label>Endpoint</label>
          <select value={endpoint} onChange={(e) => setFilter("endpoint", e.target.value)}>
            <option value="">All endpoints</option>
            <option value="/iclock/cdata">/iclock/cdata</option>
            <option value="/iclock/getrequest">/iclock/getrequest</option>
            <option value="/iclock/devicecmd">/iclock/devicecmd</option>
            <option value="/iclock/test">/iclock/test</option>
          </select>
        </div>
        <button className="btn btn-danger" disabled={selected.size === 0} onClick={deleteSelected}>
          Delete selected ({selected.size})
        </button>
      </div>

      <div className="card">
        <DataTable
          columns={columns}
          rows={table.rows}
          rowKey={(r) => r.id}
          loading={table.loading}
          sort={table.sort}
          onSort={table.toggleSort}
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          emptyMessage="No raw requests recorded yet."
          searchValue={table.searchInput}
          onSearchChange={table.setSearchInput}
          searchPlaceholder="Search serial number or endpoint…"
          selection={{ selected, toggle, toggleAll }}
        />
      </div>

      {viewing && <RawEntryDrawer entry={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
