import { useEffect, useState } from "react";
import { api, ApiError, CompanyOption } from "../api";
import { useAuth } from "../context/AuthContext";
import { useSelection } from "../hooks/useSelection";
import Pagination from "../components/Pagination";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS } from "../utils/timezoneOptions";

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
      <p className="muted">
        These serial numbers pinged /iclock/* but aren't registered as a device yet. If one arrived via your
        company's URL, that secret is captured here and carries straight into the device record when you claim it -
        nothing to reconfigure on the device afterward. Pick the device's timezone before claiming (required - used
        for accurate punch times and to tell the device itself its clock/timezone), or delete it if it's just noise.
      </p>

      {user?.role === "COMPANY_ADMIN" && companies[0] && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Connect a device</h3>
          <p className="muted">
            On the device: <strong>Menu → COMM → Cloud Server Setting</strong>. Set the server address to:
          </p>
          <code className="mono">{`${window.location.origin}/${companies[0].slug}/<any-secret-you-choose>`}</code>
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            Pick any secret string - it becomes that device's secret automatically once you register it, or the
            moment it first pings it shows up right here, ready to claim.
          </p>
        </div>
      )}

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
                      <td>{new Date(p.lastSeenAt).toLocaleString()}</td>
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
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={claiming === p.serialNumber}
                          onClick={() => onClaim(p.serialNumber)}
                        >
                          Claim
                        </button>
                        {isSuperAdmin && (
                          <button className="btn btn-sm btn-danger" onClick={() => deleteOne(p.serialNumber)}>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {pings.length === 0 && (
                    <tr>
                      <td colSpan={emptyStateColSpan} className="muted">
                        No unregistered pings recorded.
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
