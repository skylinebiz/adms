import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileCode, Fingerprint, Pencil, SquareTerminal, Trash2, Webhook } from "lucide-react";
import { api, ApiError, CompanyOption, Device } from "../api";
import { useAuth } from "../context/AuthContext";
import DeviceDrawer from "../components/DeviceDrawer";
import IconButton from "../components/IconButton";
import WebhookDrawer from "../components/WebhookDrawer";
import DeviceCommandsDrawer from "../components/DeviceCommandsDrawer";
import ConnectDeviceCard from "../components/ConnectDeviceCard";
import Pagination from "../components/Pagination";
import { formatDateTime } from "../utils/dateFormat";

const PAGE_SIZE = 25;
// Longer company names are cut to this many characters plus "…" so the
// column stays narrow; the full name shows on hover.
const COMPANY_NAME_MAX = 15;

function CompanyName({ name }: { name?: string }) {
  if (!name) return null;
  if (name.length <= COMPANY_NAME_MAX) return <>{name}</>;
  return (
    <span className="has-tooltip" data-tooltip={name} aria-label={name}>
      {name.slice(0, COMPANY_NAME_MAX).trimEnd()}…
    </span>
  );
}

export default function Devices() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editDeviceId, setEditDeviceId] = useState<string | null>(null);
  const [webhookDeviceId, setWebhookDeviceId] = useState<string | null>(null);
  const [commandsDevice, setCommandsDevice] = useState<{ id: string; serialNumber: string } | null>(null);

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
        {/* No manual register form any more (v2.16.0) - devices are added by
            letting them ping and claiming them from Unregistered Devices. */}
        <Link className="btn btn-primary" to="/unregistered-devices">
          + Add device
        </Link>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <ConnectDeviceCard
        companies={companies}
        isSuperAdmin={user?.role === "SUPER_ADMIN"}
        trailingNote={
          <>
            Pick any secret string. Once the device pings, it appears under <strong>Unregistered Devices</strong> with
            that secret already captured — claim it there and it shows up in this list.
          </>
        }
      />

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="table-wrap">
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
                    {user?.role === "SUPER_ADMIN" && (
                      <td>
                        <CompanyName name={d.company?.name} />
                      </td>
                    )}
                    <td>
                      <span className={`badge badge-${d.status.toLowerCase()}`}>{d.status}</span>
                    </td>
                    <td>
                      {d.lastSeenAt ? formatDateTime(d.lastSeenAt) : <span className="muted">never</span>}
                    </td>
                    <td>
                      {/* Configured/enabled indicator only - never the URL itself, even masked,
                          to keep this list from doubling as a place webhook endpoints leak into view. */}
                      {d.webhookUrlMasked ? (
                        <span
                          className={`badge ${d.webhookEnabled ? "badge-delivered" : "badge-offline"}`}
                          title={d.webhookEnabled ? "Webhook configured and enabled" : "Webhook configured but disabled"}
                        >
                          {d.webhookEnabled ? "● Enabled" : "○ Disabled"}
                        </span>
                      ) : (
                        <span className="muted" title="No webhook configured for this device">
                          Not configured
                        </span>
                      )}
                    </td>
                    <td className="actions-cell">
                      <IconButton icon={Pencil} label="Edit" onClick={() => setEditDeviceId(d.id)} />
                      <IconButton icon={Webhook} label="Webhook" onClick={() => setWebhookDeviceId(d.id)} />
                      <IconButton
                        icon={SquareTerminal}
                        label="Commands"
                        onClick={() => setCommandsDevice({ id: d.id, serialNumber: d.serialNumber })}
                      />
                      <IconButton icon={Fingerprint} label="Punches" to={`/punch-records?deviceId=${d.id}`} />
                      <IconButton icon={FileCode} label="Raw Data" to={`/raw-data?deviceId=${d.id}`} />
                      <IconButton icon={Trash2} label="Delete" variant="danger" onClick={() => onDelete(d.id)} />
                    </td>
                  </tr>
                ))}
                {devices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No devices yet. Point a device at the URL above, then claim it from{" "}
                      <Link to="/unregistered-devices">Unregistered Devices</Link>.
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

      {editDeviceId && (
        <DeviceDrawer
          deviceId={editDeviceId}
          companies={companies}
          onClose={() => setEditDeviceId(null)}
          onSaved={load}
        />
      )}

      {webhookDeviceId && (
        <WebhookDrawer deviceId={webhookDeviceId} onClose={() => setWebhookDeviceId(null)} onSaved={load} />
      )}

      {commandsDevice && (
        <DeviceCommandsDrawer
          deviceId={commandsDevice.id}
          serialNumber={commandsDevice.serialNumber}
          onClose={() => setCommandsDevice(null)}
        />
      )}
    </div>
  );
}
