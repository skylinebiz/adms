import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, DeviceOption, PunchRecord } from "../api";
import { useAuth } from "../context/AuthContext";
import { useSelection } from "../hooks/useSelection";
import { useDataTable } from "../hooks/useDataTable";
import { formatAccurateTime, formatPunchTime } from "../utils/formatTime";
import { webhookStatusLabel } from "../utils/webhookStatus";
import DeliveryLogDrawer from "./DeliveryLogDrawer";
import DataTable, { Column } from "./DataTable";
import { RotateCw, ScrollText, Trash2 } from "lucide-react";
import IconButton from "./IconButton";

export default function PunchRecordsTable({ mode }: { mode: "all" | "failed" }) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const canRetryBulk = mode === "failed";
  const canDelete = isSuperAdmin;
  const showCheckboxColumn = canRetryBulk || canDelete;

  const [params, setParams] = useSearchParams();
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [actionError, setError] = useState<string | null>(null);
  const { selected, toggle, toggleAll, clear } = useSelection();
  const [viewingDeliveries, setViewingDeliveries] = useState<string | null>(null);

  const deviceId = params.get("deviceId") ?? "";
  const status = params.get("status") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const table = useDataTable<PunchRecord>({
    fetcher: async (q) => {
      const query = {
        deviceId: deviceId || undefined,
        status: mode === "all" ? status || undefined : undefined,
        from: from || undefined,
        to: to || undefined,
        page: String(q.page),
        pageSize: String(q.pageSize),
        sortBy: q.sortBy,
        sortDir: q.sortDir,
        search: q.search,
      };
      const result = mode === "failed" ? await api.listFailedPunchRecords(query) : await api.listPunchRecords(query);
      return { rows: result.records, total: result.total };
    },
    // The failed view's server-side default is "most recent attempt first",
    // which isn't one of the sortable columns - so no header shows active.
    defaultSort: mode === "failed" ? { sortBy: "", sortDir: "desc" } : { sortBy: "punchTime", sortDir: "desc" },
    deps: [mode, deviceId, status, from, to],
    errorMessage: "Failed to load punch records",
  });
  const error = actionError ?? table.error;
  const load = table.reload;

  useEffect(() => {
    // Unpaginated (capped) - a filter dropdown needs the full set, not a page of it.
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

  async function retryOne(id: string) {
    await api.retryPunchRecord(id);
    await load();
  }

  async function retrySelected() {
    if (selected.size === 0) return;
    await api.retryBulk(Array.from(selected));
    clear();
    await load();
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this punch record? This cannot be undone.")) return;
    await api.deletePunchRecord(id);
    await load();
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} punch record(s)? This cannot be undone.`)) return;
    await api.deletePunchRecordsBulk(Array.from(selected));
    clear();
    await load();
  }

  const columns: Column<PunchRecord>[] = [
    { key: "devicePin", header: "PIN", sortable: true, render: (r) => r.devicePin },
    { key: "device", header: "Device", sortable: true, render: (r) => r.device?.label ?? r.device?.serialNumber },
    {
      key: "punchTime",
      header: "Punch time",
      title: "Shown exactly as the device's own clock reported it, not converted to your timezone",
      sortable: true,
      render: (r) => formatPunchTime(r.punchTime),
    },
    {
      key: "punchTimeUtc",
      header: "Accurate time",
      title:
        "The real UTC instant, computed from the device's configured timezone - shown in your local time. Blank if the device has no timezone configured.",
      sortable: true,
      render: (r) => formatAccurateTime(r.punchTimeUtc),
    },
    { key: "verifyMode", header: "Verify mode", render: (r) => r.verifyMode },
    {
      key: "webhookStatus",
      header: "Webhook status",
      render: (r) => <span className={`badge badge-${r.webhookStatus}`}>{webhookStatusLabel(r.webhookStatus)}</span>,
    },
    { key: "webhookAttempts", header: "Attempts", sortable: true, render: (r) => r.webhookAttempts },
    ...(mode === "failed"
      ? [
          {
            key: "lastWebhookError",
            header: "Last error",
            cellClassName: "muted",
            cellStyle: { maxWidth: 260, whiteSpace: "normal" as const },
            render: (r: PunchRecord) => r.lastWebhookError ?? "—",
          },
        ]
      : []),
    {
      key: "actions",
      header: "",
      cellClassName: "actions-cell",
      render: (r) => (
        <>
          <IconButton icon={ScrollText} label="Delivery log" onClick={() => setViewingDeliveries(r.id)} />
          {r.webhookStatus !== "delivered" && (
            <IconButton
              icon={RotateCw}
              label="Retry now"
              tooltip={r.canRetry ? undefined : "Retry unavailable - no active webhook"}
              disabled={!r.canRetry}
              onClick={() => retryOne(r.id)}
            />
          )}
          {canDelete && <IconButton icon={Trash2} label="Delete" variant="danger" onClick={() => deleteOne(r.id)} />}
        </>
      ),
    },
  ];

  return (
    <div>
      <div className="filters">
        <div className="field">
          <label>Device</label>
          <select value={deviceId} onChange={(e) => setFilter("deviceId", e.target.value)}>
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label ?? d.serialNumber}
              </option>
            ))}
          </select>
        </div>
        {mode === "all" && (
          <div className="field">
            <label>Status</label>
            <select value={status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">All</option>
              <option value="delivered">Delivered</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="not_applicable">NA (no webhook)</option>
            </select>
          </div>
        )}
        <div className="field">
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFilter("from", e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setFilter("to", e.target.value)} />
        </div>
        {canRetryBulk && (
          <button className="btn btn-primary" disabled={selected.size === 0} onClick={retrySelected}>
            Retry selected ({selected.size})
          </button>
        )}
        {canDelete && (
          <button className="btn btn-danger" disabled={selected.size === 0} onClick={deleteSelected}>
            Delete selected ({selected.size})
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

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
          emptyMessage="No punch records found."
          searchValue={table.searchInput}
          onSearchChange={table.setSearchInput}
          searchPlaceholder="Search PIN or device…"
          selection={showCheckboxColumn ? { selected, toggle, toggleAll } : undefined}
        />
      </div>

      {viewingDeliveries && (
        <DeliveryLogDrawer punchRecordId={viewingDeliveries} onClose={() => setViewingDeliveries(null)} />
      )}
    </div>
  );
}
