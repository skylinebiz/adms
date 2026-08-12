import { useEffect, useState } from "react";
import { api, ApiError, CompanyOption } from "../api";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 25;

export default function UnregisteredDevices() {
  const [pings, setPings] = useState<{ serialNumber: string; pingCount: number; lastSeenAt: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [companyChoice, setCompanyChoice] = useState<Record<string, string>>({});

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function onClaim(serialNumber: string) {
    const companyId = companyChoice[serialNumber];
    if (!companyId) {
      setError("Choose a company before claiming a device");
      return;
    }
    setClaiming(serialNumber);
    setError(null);
    try {
      await api.claimDevice({ serialNumber, companyId });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to claim device");
    } finally {
      setClaiming(null);
    }
  }

  return (
    <div>
      <h2>Unregistered Devices</h2>
      <p className="muted">
        These serial numbers pinged /iclock/* but aren't assigned to a company yet. Claim one into a company to
        start capturing its punches.
      </p>
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
                  <th>Serial number</th>
                  <th>Ping count</th>
                  <th>Last seen</th>
                  <th>Claim into company</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pings.map((p) => (
                  <tr key={p.serialNumber}>
                    <td>
                      <code className="mono">{p.serialNumber}</code>
                    </td>
                    <td>{p.pingCount}</td>
                    <td>{new Date(p.lastSeenAt).toLocaleString()}</td>
                    <td>
                      <select
                        value={companyChoice[p.serialNumber] ?? ""}
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
                    <td>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={claiming === p.serialNumber}
                        onClick={() => onClaim(p.serialNumber)}
                      >
                        Claim
                      </button>
                    </td>
                  </tr>
                ))}
                {pings.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
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
