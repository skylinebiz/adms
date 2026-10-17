import { useEffect, useState } from "react";
import { api, ApiError, CompanyOption } from "../api";
import { useAuth } from "../context/AuthContext";
import { useSelection } from "../hooks/useSelection";
import DataTable, { Column } from "../components/DataTable";
import { useDataTable } from "../hooks/useDataTable";
import AddDeviceGuide from "../components/AddDeviceGuide";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS } from "../utils/timezoneOptions";
import { formatDateTime } from "../utils/dateFormat";
import { CirclePlus, RefreshCw, Trash2 } from "lucide-react";
import IconButton from "../components/IconButton";

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
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [actionError, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [companyChoice, setCompanyChoice] = useState<Record<string, string>>({});
  const [timezoneChoice, setTimezoneChoice] = useState<Record<string, string>>({});
  const { selected, toggle, toggleAll, clear } = useSelection();

  const table = useDataTable<Ping>({
    fetcher: async (q) => {
      const r = await api.listUnregisteredPings(q);
      return { rows: r.pings, total: r.total };
    },
    defaultSort: { sortBy: "lastSeenAt", sortDir: "desc" },
    errorMessage: "Failed to load unregistered devices",
  });
  const pings = table.rows;
  const loading = table.loading;
  const error = actionError ?? table.error;
  const load = table.reload;

  useEffect(() => {
    api.listCompanyOptions().then((c) => setCompanies(c.companies));
  }, []);

  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.rows]);

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

  const columns: Column<Ping>[] = [
    {
      key: "serialNumber",
      header: "Serial number",
      sortable: true,
      render: (p) => <code className="mono">{p.serialNumber}</code>,
    },
    {
      key: "secret",
      header: "Secret",
      render: (p) =>
        p.secret ? <code className="mono">{p.secret}</code> : <span className="muted">none (open path)</span>,
    },
    ...(isSuperAdmin
      ? [
          {
            key: "company",
            header: "Company",
            sortable: true,
            render: (p: Ping) =>
              p.company ? (
                p.company.name
              ) : (
                <span className="muted" title="Legacy /iclock ping or an unresolved company URL">
                  unscoped
                </span>
              ),
          },
        ]
      : []),
    { key: "pingCount", header: "Ping count", sortable: true, render: (p) => p.pingCount },
    { key: "lastSeenAt", header: "Last seen", sortable: true, render: (p) => formatDateTime(p.lastSeenAt) },
    ...(isSuperAdmin
      ? [
          {
            key: "claimCompany",
            header: "Claim into company",
            cellStyle: { minWidth: 180 },
            render: (p: Ping) => (
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
            ),
          },
        ]
      : []),
    {
      key: "timezone",
      header: "Timezone",
      // min-width so the selected zone's label (e.g. "(UTC+05:30) Asia/Calcutta")
      // stays legible instead of the auto table layout squeezing this column down
      // to a sliver - the admin needs to actually read what's picked before claiming.
      cellStyle: { minWidth: 240 },
      render: (p) => (
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
      ),
    },
    {
      key: "actions",
      header: "",
      cellClassName: "actions-cell",
      render: (p) => (
        <>
          <IconButton
            icon={CirclePlus}
            label="Claim"
            variant="primary"
            disabled={claiming === p.serialNumber}
            onClick={() => onClaim(p.serialNumber)}
          />
          {isSuperAdmin && (
            <IconButton icon={Trash2} label="Delete" variant="danger" onClick={() => deleteOne(p.serialNumber)} />
          )}
        </>
      ),
    },
  ];

  return (
    <div>
      <h2>Unregistered Devices</h2>
      {/* The one supported way to add a device (v2.16.0 dropped the manual
          "Register device" form) - the Devices page's "+ Add device" lands here. */}
      <AddDeviceGuide companies={companies} isSuperAdmin={isSuperAdmin} />

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="card-header">
          <h3>Waiting to be claimed</h3>
          <div className="card-header-actions">
            {isSuperAdmin && selected.size > 0 && (
              <button className="btn btn-sm btn-danger" onClick={deleteSelected}>
                Delete selected ({selected.size})
              </button>
            )}
            <button className="btn btn-sm" onClick={load} disabled={loading}>
              <RefreshCw size={13} aria-hidden /> Refresh
            </button>
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={pings}
          rowKey={(p) => p.serialNumber}
          loading={loading}
          sort={table.sort}
          onSort={table.toggleSort}
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          emptyMessage="No devices yet — once one pings, it shows up here."
          searchValue={table.searchInput}
          onSearchChange={table.setSearchInput}
          searchPlaceholder="Search serial number or company…"
          selection={isSuperAdmin ? { selected, toggle, toggleAll } : undefined}
        />
      </div>
    </div>
  );
}
