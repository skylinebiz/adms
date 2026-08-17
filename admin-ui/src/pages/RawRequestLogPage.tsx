import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, RawRequestLog } from "../api";
import { useSelection } from "../hooks/useSelection";
import Pagination from "../components/Pagination";
import RawEntryDrawer from "../components/RawEntryDrawer";

const PAGE_SIZE = 25;

export default function RawRequestLogPage() {
  const [params, setParams] = useSearchParams();
  const [requests, setRequests] = useState<RawRequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<RawRequestLog | null>(null);
  const { selected, toggle, toggleAll, clear } = useSelection();

  const serialNumber = params.get("serialNumber") ?? "";
  const endpoint = params.get("endpoint") ?? "";

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listRawRequests({
        serialNumber: serialNumber || undefined,
        endpoint: endpoint || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setRequests(result.requests);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load raw request log");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialNumber, endpoint, page]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    setPage(1);
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this raw request entry? This cannot be undone.")) return;
    await api.deleteRawRequest(id);
    await load();
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} raw request entr${selected.size === 1 ? "y" : "ies"}? This cannot be undone.`)) return;
    await api.deleteRawRequestsBulk(Array.from(selected));
    clear();
    await load();
  }

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
          <label>Serial number</label>
          <input
            placeholder="Filter by exact SN"
            value={serialNumber}
            onChange={(e) => setFilter("serialNumber", e.target.value)}
          />
        </div>
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
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={requests.length > 0 && requests.every((r) => selected.has(r.id))}
                      onChange={() => toggleAll(requests.map((r) => r.id))}
                    />
                  </th>
                  <th>Received</th>
                  <th>SN</th>
                  <th>Method</th>
                  <th>Endpoint</th>
                  <th>Body size</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                    <td>
                      {r.serialNumber ? (
                        <code className="mono">{r.serialNumber}</code>
                      ) : (
                        <span className="muted">(missing)</span>
                      )}
                    </td>
                    <td>{r.method}</td>
                    <td>
                      <code className="mono">{r.endpoint}</code>
                    </td>
                    <td>{r.rawBody?.length ?? 0} chars</td>
                    <td className="actions-cell">
                      <button className="btn btn-sm" onClick={() => setViewing(r)}>
                        View
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteOne(r.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No raw requests recorded yet.
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
