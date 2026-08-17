import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, DeviceOption, DeviceRawLog } from "../api";
import { useAuth } from "../context/AuthContext";
import { useSelection } from "../hooks/useSelection";
import Pagination from "../components/Pagination";
import RawEntryDrawer from "../components/RawEntryDrawer";

const PAGE_SIZE = 25;

export default function RawDataDump() {
  const { user } = useAuth();
  const canDelete = user?.role === "SUPER_ADMIN";

  const [params, setParams] = useSearchParams();
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [logs, setLogs] = useState<DeviceRawLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<DeviceRawLog | null>(null);
  const { selected, toggle, toggleAll, clear } = useSelection();

  const deviceId = params.get("deviceId") ?? "";
  const table = params.get("table") ?? "";

  useEffect(() => {
    api.listDeviceOptions().then(({ devices }) => setDevices(devices));
  }, []);

  async function load() {
    if (!deviceId) {
      setLogs([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.getDeviceRawLogs(deviceId, { table: table || undefined, page, pageSize: PAGE_SIZE });
      setLogs(result.logs);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load raw data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, table, page]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    setPage(1);
  }

  async function deleteOne(id: string) {
    if (!deviceId) return;
    if (!confirm("Delete this raw data entry? This cannot be undone.")) return;
    await api.deleteDeviceRawLog(deviceId, id);
    await load();
  }

  async function deleteSelected() {
    if (!deviceId || selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} raw data entr${selected.size === 1 ? "y" : "ies"}? This cannot be undone.`)) return;
    await api.deleteDeviceRawLogsBulk(deviceId, Array.from(selected));
    clear();
    await load();
  }

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
            value={table}
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
        ) : loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {canDelete && (
                    <th>
                      <input
                        type="checkbox"
                        checked={logs.length > 0 && logs.every((l) => selected.has(l.id))}
                        onChange={() => toggleAll(logs.map((l) => l.id))}
                      />
                    </th>
                  )}
                  <th>Received</th>
                  <th>Table</th>
                  <th>Endpoint</th>
                  <th>Method</th>
                  <th>Body size</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    {canDelete && (
                      <td>
                        <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                      </td>
                    )}
                    <td>{new Date(l.createdAt).toLocaleString()}</td>
                    <td>{l.table ? <span className="badge badge-pending">{l.table}</span> : <span className="muted">—</span>}</td>
                    <td>
                      <code className="mono">{l.endpoint}</code>
                    </td>
                    <td>{l.method}</td>
                    <td>{l.rawBody?.length ?? 0} chars</td>
                    <td className="actions-cell">
                      <button className="btn btn-sm" onClick={() => setViewing(l)}>
                        View
                      </button>
                      {canDelete && (
                        <button className="btn btn-sm btn-danger" onClick={() => deleteOne(l.id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={canDelete ? 7 : 6} className="muted">
                      No raw (non-ATTLOG) data recorded for this device yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </div>

      {viewing && <RawEntryDrawer entry={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
