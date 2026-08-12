import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, DeviceOption, PunchRecord } from "../api";
import { useAuth } from "../context/AuthContext";
import { useSelection } from "../hooks/useSelection";
import { formatPunchTime } from "../utils/formatTime";
import { webhookStatusLabel } from "../utils/webhookStatus";
import DeliveryLogDrawer from "./DeliveryLogDrawer";
import Pagination from "./Pagination";

export default function PunchRecordsTable({ mode }: { mode: "all" | "failed" }) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const canRetryBulk = mode === "failed";
  const canDelete = isSuperAdmin;
  const showCheckboxColumn = canRetryBulk || canDelete;

  const [params, setParams] = useSearchParams();
  const [records, setRecords] = useState<PunchRecord[]>([]);
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { selected, toggle, toggleAll, clear } = useSelection();
  const [viewingDeliveries, setViewingDeliveries] = useState<string | null>(null);

  const deviceId = params.get("deviceId") ?? "";
  const status = params.get("status") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  useEffect(() => {
    // Unpaginated (capped) - a filter dropdown needs the full set, not a page of it.
    api.listDeviceOptions().then(({ devices }) => setDevices(devices));
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const query = {
        deviceId: deviceId || undefined,
        status: mode === "all" ? status || undefined : undefined,
        from: from || undefined,
        to: to || undefined,
        page: String(page),
        pageSize: String(pageSize),
      };
      const result = mode === "failed" ? await api.listFailedPunchRecords(query) : await api.listPunchRecords(query);
      setRecords(result.records);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load punch records");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, deviceId, status, from, to, page]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    setPage(1);
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
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {showCheckboxColumn && (
                    <th>
                      <input
                        type="checkbox"
                        checked={records.length > 0 && records.every((r) => selected.has(r.id))}
                        onChange={() => toggleAll(records.map((r) => r.id))}
                      />
                    </th>
                  )}
                  <th>PIN</th>
                  <th>Device</th>
                  <th title="Shown exactly as the device's own clock reported it, not converted to your timezone">
                    Punch time
                  </th>
                  <th>Verify mode</th>
                  <th>Webhook status</th>
                  <th>Attempts</th>
                  {mode === "failed" && <th>Last error</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    {showCheckboxColumn && (
                      <td>
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                      </td>
                    )}
                    <td>{r.devicePin}</td>
                    <td>{r.device?.label ?? r.device?.serialNumber}</td>
                    <td>{formatPunchTime(r.punchTime)}</td>
                    <td>{r.verifyMode}</td>
                    <td>
                      <span className={`badge badge-${r.webhookStatus}`}>{webhookStatusLabel(r.webhookStatus)}</span>
                    </td>
                    <td>{r.webhookAttempts}</td>
                    {mode === "failed" && (
                      <td style={{ maxWidth: 260, whiteSpace: "normal" }} className="muted">
                        {r.lastWebhookError ?? "—"}
                      </td>
                    )}
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-sm" onClick={() => setViewingDeliveries(r.id)}>
                        Log
                      </button>
                      {r.webhookStatus !== "delivered" && (
                        <button className="btn btn-sm" onClick={() => retryOne(r.id)}>
                          Retry now
                        </button>
                      )}
                      {canDelete && (
                        <button className="btn btn-sm btn-danger" onClick={() => deleteOne(r.id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">
                      No punch records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </>
        )}
      </div>

      {viewingDeliveries && (
        <DeliveryLogDrawer punchRecordId={viewingDeliveries} onClose={() => setViewingDeliveries(null)} />
      )}
    </div>
  );
}
