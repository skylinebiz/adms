import { useEffect, useState } from "react";
import { api, ApiError, CompanyOption } from "../api";
import { useAuth } from "../context/AuthContext";
import { useSelection } from "../hooks/useSelection";
import Pagination from "../components/Pagination";
import ConnectDeviceCard from "../components/ConnectDeviceCard";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS } from "../utils/timezoneOptions";
import { formatDateTime } from "../utils/dateFormat";
import { CirclePlus, Trash2 } from "lucide-react";
import IconButton from "../components/IconButton";

const PAGE_SIZE = 25;

interface Ping {
  serialNumber: string;
  pingCount: number;
  lastSeenAt: string;
  secret: string | null;
  companyId: string | null;
  company: { id: string; name: string; slug: string } | null;
}

export default function UnregisteredDevices() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const [pings, setPings] = useState<Ping[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [companyChoice, setCompanyChoice] = useState<Record<string, string>>({});
  const [timezoneChoice, setTimezoneChoice] = useState<Record<string, string>>({});
  const { selected, toggle, toggleAll, clear } = useSelection();

  async function load() {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api.listUnregisteredPings({ page, pageSize: PAGE_SIZE }),
        api.listCompanyOptions(),
      ]);
      setPings(p.pings);
      setTotal(p.total);
      setCompanies(c.companies);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load unregistered devices");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function onClaim(serialNumber: string) {
    // company_admin: implicitly their own company - self-service, no picker
    // needed since the ping is already scoped to them. super_admin: the
    // per-row picker, pre-filled with the ping's resolved company (if any).
    const companyId = isSuperAdmin
      ? companyChoice[serialNumber] ?? pings.find((p) => p.serialNumber === serialNumber)?.companyId
      : user?.companyId;
    if (!companyId) {
      setError("Choose a company before claiming a device");
      return;
    }
    const timezone = timezoneChoice[serialNumber] ?? DEFAULT_TIMEZONE;
    setClaiming(serialNumber);
    setError(null);
    try {
      await api.claimDevice({ serialNumber, companyId, timezone });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to claim device");
    } finally {
      setClaiming(null);
    }
  }

  async function deleteOne(serialNumber: string) {
    if (!confirm(`Delete all logged pings for "${serialNumber}"? This cannot be undone.`)) return;
    try {
      await api.deleteUnregisteredPing(serialNumber);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} unregistered device(s)? This cannot be undone.`)) return;
    try {
      await api.deleteUnregisteredPingsBulk(Array.from(selected));
      clear();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  const emptyStateColSpan = isSuperAdmin ? 9 : 6;

  return (
    <div>
      <h2>Unregistered Devices</h2>
      {/* The one supported way to add a device (v2.16.0 dropped the manual
          "Register device" form from the Devices page) - spelled out as
          explicit steps so nobody goes looking for another path. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>How to add a device</h3>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            On the device, set the Cloud Server address to one of the URLs in <strong>Connect a device</strong> below.
          </li>
          <li>
            Wait for its first ping — it appears in the table at the bottom of this page with its secret already
            captured (refresh if it doesn't show up right away).
          </li>
          <li>
            Pick the device's timezone and click <strong>Claim</strong> (
            <CirclePlus size={13} style={{ verticalAlign: "-2px" }} aria-hidden />
            ). It then moves to <strong>Devices</strong>,
            with nothing to reconfigure on the device itself.
          </li>
        </ol>
        <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
          The timezone is required — it's used for accurate punch times and to tell the device its own clock/timezone.
          If a row here is just noise, delete it instead.
        </p>
      </div>

      <ConnectDeviceCard
        companies={companies}
        isSuperAdmin={isSuperAdmin}
        trailingNote="Pick any secret string — it's captured automatically on the device's first ping and becomes its secret when you claim it."
      />

      {error && <div className="error-banner">{error}</div>}

      {isSuperAdmin && (
        <div className="toolbar">
          <div />
          <button className="btn btn-danger" disabled={selected.size === 0} onClick={deleteSelected}>
            Delete selected ({selected.size})
          </button>
        </div>
      )}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {isSuperAdmin && (
                      <th>
                        <input
                          type="checkbox"
                          checked={pings.length > 0 && pings.every((p) => selected.has(p.serialNumber))}
                          onChange={() => toggleAll(pings.map((p) => p.serialNumber))}
                        />
                      </th>
                    )}
                    <th>Serial number</th>
                    <th>Secret</th>
                    {isSuperAdmin && <th>Company</th>}
                    <th>Ping count</th>
                    <th>Last seen</th>
                    {isSuperAdmin && <th>Claim into company</th>}
                    <th>Timezone</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pings.map((p) => (
                    <tr key={p.serialNumber}>
                      {isSuperAdmin && (
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(p.serialNumber)}
                            onChange={() => toggle(p.serialNumber)}
                          />
                        </td>
                      )}
                      <td>
                        <code className="mono">{p.serialNumber}</code>
                      </td>
                      <td>
                        {p.secret ? (
                          <code className="mono">{p.secret}</code>
                        ) : (
                          <span className="muted">none (open path)</span>
                        )}
                      </td>
                      {isSuperAdmin && (
                        <td>
                          {p.company ? (
                            p.company.name
                          ) : (
                            <span className="muted" title="Legacy /iclock ping or an unresolved company URL">
                              unscoped
                            </span>
                          )}
                        </td>
                      )}
                      <td>{p.pingCount}</td>
                      <td>{formatDateTime(p.lastSeenAt)}</td>
                      {isSuperAdmin && (
                        <td style={{ minWidth: 180 }}>
                          <select
                            value={companyChoice[p.serialNumber] ?? p.companyId ?? ""}
                            onChange={(e) => setCompanyChoice((s) => ({ ...s, [p.serialNumber]: e.target.value }))}
                          >
                            <option value="">Select company…</option>
                            {companies.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      {/* min-width so the selected zone's label (e.g. "(UTC+05:30) Asia/Calcutta")
                          stays legible instead of the auto table layout squeezing this column down
                          to a sliver - the admin needs to actually read what's picked before claiming. */}
                      <td style={{ minWidth: 240 }}>
                        <select
                          value={timezoneChoice[p.serialNumber] ?? DEFAULT_TIMEZONE}
                          onChange={(e) => setTimezoneChoice((s) => ({ ...s, [p.serialNumber]: e.target.value }))}
                        >
                          {TIMEZONE_OPTIONS.map((opt) => (
                            <option key={opt.tz} value={opt.tz}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="actions-cell">
                        <IconButton
                          icon={CirclePlus}
                          label="Claim"
                          variant="primary"
                          disabled={claiming === p.serialNumber}
                          onClick={() => onClaim(p.serialNumber)}
                        />
                        {isSuperAdmin && (
                          <IconButton
                            icon={Trash2}
                            label="Delete"
                            variant="danger"
                            onClick={() => deleteOne(p.serialNumber)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                  {pings.length === 0 && (
                    <tr>
                      <td colSpan={emptyStateColSpan} className="muted">
                        Waiting for a device to ping… Configure it using the URL above, then refresh this page.
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
    </div>
  );
}
