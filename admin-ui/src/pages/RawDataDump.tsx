import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, DeviceOption, DeviceRawLog } from "../api";
import { useAuth } from "../context/AuthContext";
import { useSelection } from "../hooks/useSelection";
import { useDataTable } from "../hooks/useDataTable";
import DataTable, { Column } from "../components/DataTable";
import RawEntryDrawer from "../components/RawEntryDrawer";
import { formatDateTime } from "../utils/dateFormat";
import { Eye, Trash2 } from "lucide-react";
import IconButton from "../components/IconButton";

export default function RawDataDump() {
  const { user } = useAuth();
  const canDelete = user?.role === "SUPER_ADMIN";

  const [params, setParams] = useSearchParams();
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [actionError, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<DeviceRawLog | null>(null);
  const { selected, toggle, toggleAll, clear } = useSelection();

  const deviceId = params.get("deviceId") ?? "";
  const tableFilter = params.get("table") ?? "";

  const table = useDataTable<DeviceRawLog>({
    fetcher: async (q) => {
      const result = await api.getDeviceRawLogs(deviceId, { ...q, table: tableFilter || undefined });
      return { rows: result.logs, total: result.total };
    },
    defaultSort: { sortBy: "createdAt", sortDir: "desc" },
    deps: [deviceId, tableFilter],
    enabled: Boolean(deviceId),
    errorMessage: "Failed to load raw data",
  });
  const error = actionError ?? table.error;
  const load = table.reload;

  useEffect(() => {
    api.listDeviceOptions().then(({ devices }) => setDevices(devices));
  }, []);

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
    if (!deviceId) return;
    if (!confirm("Delete this raw data entry? This cannot be undone.")) return;
    try {
      await api.deleteDeviceRawLog(deviceId, id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  async function deleteSelected() {
    if (!deviceId || selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} raw data entr${selected.size === 1 ? "y" : "ies"}? This cannot be undone.`)) return;
    try {
      await api.deleteDeviceRawLogsBulk(deviceId, Array.from(selected));
      clear();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  const columns: Column<DeviceRawLog>[] = [
    { key: "createdAt", header: "Received", sortable: true, render: (l) => formatDateTime(l.createdAt) },
    {
      key: "table",
      header: "Table",
      sortable: true,
      render: (l) => (l.table ? <span className="badge badge-pending">{l.table}</span> : <span className="muted">—</span>),
    },
    {
      key: "endpoint",
      header: "Endpoint",
      sortable: true,
      render: (l) => <code className="mono">{l.endpoint}</code>,
    },
    { key: "method", header: "Method", render: (l) => l.method },
    { key: "bodySize", header: "Body size", render: (l) => `${l.rawBody?.length ?? 0} chars` },
    {
      key: "actions",
      header: "",
      cellClassName: "actions-cell",
      render: (l) => (
        <>
          <IconButton icon={Eye} label="View" onClick={() => setViewing(l)} />
          {canDelete && <IconButton icon={Trash2} label="Delete" variant="danger" onClick={() => deleteOne(l.id)} />}
        </>
      ),
    },
  ];

  return (
    <div>
      <h2>Raw Data Dump</h2>
      <p className="muted">
        Anything a device pushes that isn't a punch (ATTLOG) - OPERLOG, USERINFO, FINGERTMP, FACE, photos, or any
        other table name a firmware variant sends - captured verbatim per device.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="filters">
        <div className="field">
          <label>Device</label>
          <select value={deviceId} onChange={(e) => setFilter("deviceId", e.target.value)}>
            <option value="">Select a device…</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label ?? d.serialNumber}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Table</label>
          <input
            placeholder="e.g. OPERLOG, USERINFO"
            value={tableFilter}
            onChange={(e) => setFilter("table", e.target.value)}
          />
        </div>
        {canDelete && deviceId && (
          <button className="btn btn-danger" disabled={selected.size === 0} onClick={deleteSelected}>
            Delete selected ({selected.size})
          </button>
        )}
      </div>

      <div className="card">
        {!deviceId ? (
          <p className="muted">Select a device above to see its raw data dump.</p>
        ) : (
          <DataTable
            columns={columns}
            rows={table.rows}
            rowKey={(l) => l.id}
            loading={table.loading}
            sort={table.sort}
            onSort={table.toggleSort}
            page={table.page}
            pageSize={table.pageSize}
            total={table.total}
            onPageChange={table.setPage}
            onPageSizeChange={table.setPageSize}
            emptyMessage="No raw (non-ATTLOG) data recorded for this device yet."
            searchValue={table.searchInput}
            onSearchChange={table.setSearchInput}
            searchPlaceholder="Search table or endpoint…"
            selection={canDelete ? { selected, toggle, toggleAll } : undefined}
          />
        )}
      </div>

      {viewing && <RawEntryDrawer entry={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
