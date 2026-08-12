import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, CompanyOption, Device } from "../api";
import { useAuth } from "../context/AuthContext";
import DeviceDrawer from "../components/DeviceDrawer";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 25;

export default function Devices() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ mode: "create" | "edit"; deviceId: string | null } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([
        api.listDevices({ page, pageSize: PAGE_SIZE }),
        api.listCompanyOptions(),
      ]);
      setDevices(d.devices);
      setTotal(d.total);
      setCompanies(c.companies);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function onDelete(id: string) {
    if (!confirm("Delete this device and all its punch records? This cannot be undone.")) return;
    try {
      await api.deleteDevice(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete device");
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Devices</h2>
        <button className="btn btn-primary" onClick={() => setDrawer({ mode: "create", deviceId: null })}>
          + Register device
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Serial number</th>
                  <th>Label</th>
                  {user?.role === "SUPER_ADMIN" && <th>Company</th>}
                  <th>Status</th>
                  <th>Last seen</th>
                  <th>Webhook</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <code className="mono">{d.serialNumber}</code>
                    </td>
                    <td>{d.label ?? <span className="muted">—</span>}</td>
                    {user?.role === "SUPER_ADMIN" && <td>{d.company?.name}</td>}
                    <td>
                      <span className={`badge badge-${d.status.toLowerCase()}`}>{d.status}</span>
                    </td>
                    <td>
                      {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : <span className="muted">never</span>}
                    </td>
                    <td>
                      {d.webhookUrlMasked ? (
                        <>
                          <code className="mono">{d.webhookUrlMasked}</code>{" "}
                          {d.webhookEnabled ? (
                            <span className="badge badge-delivered">on</span>
                          ) : (
                            <span className="badge badge-offline">off</span>
                          )}
                        </>
                      ) : (
                        <span className="muted">not set</span>
                      )}
                    </td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-sm" onClick={() => setDrawer({ mode: "edit", deviceId: d.id })}>
                        Edit
                      </button>
                      <Link className="btn btn-sm" to={`/punch-records?deviceId=${d.id}`}>
                        Punches
                      </Link>
                      <Link className="btn btn-sm" to={`/raw-data?deviceId=${d.id}`}>
                        Raw Data
                      </Link>
                      <button className="btn btn-sm btn-danger" onClick={() => onDelete(d.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {devices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No devices registered yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </div>

      {drawer && (
        <DeviceDrawer
          mode={drawer.mode}
          deviceId={drawer.deviceId}
          companies={companies}
          onClose={() => setDrawer(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
