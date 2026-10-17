import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileCode, Fingerprint, Pencil, SquareTerminal, Trash2, Webhook } from "lucide-react";
import { api, ApiError, CompanyOption, Device } from "../api";
import { useAuth } from "../context/AuthContext";
import DeviceDrawer from "../components/DeviceDrawer";
import IconButton from "../components/IconButton";
import WebhookDrawer from "../components/WebhookDrawer";
import DeviceCommandsDrawer from "../components/DeviceCommandsDrawer";
import DataTable, { Column } from "../components/DataTable";
import { useDataTable } from "../hooks/useDataTable";
import { formatDateTime } from "../utils/dateFormat";

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
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [actionError, setError] = useState<string | null>(null);
  const [editDeviceId, setEditDeviceId] = useState<string | null>(null);
  const [webhookDeviceId, setWebhookDeviceId] = useState<string | null>(null);
  const [commandsDevice, setCommandsDevice] = useState<{ id: string; serialNumber: string } | null>(null);

  const table = useDataTable<Device>({
    fetcher: async (q) => {
      const r = await api.listDevices({
        ...q,
        status: statusFilter || undefined,
        companyId: companyFilter || undefined,
      });
      return { rows: r.devices, total: r.total };
    },
    defaultSort: { sortBy: "createdAt", sortDir: "desc" },
    deps: [statusFilter, companyFilter],
    errorMessage: "Failed to load devices",
  });
  const error = actionError ?? table.error;
  const load = table.reload;

  useEffect(() => {
    api.listCompanyOptions().then((c) => setCompanies(c.companies));
  }, []);

  async function onDelete(id: string) {
    if (!confirm("Delete this device and all its punch records? This cannot be undone.")) return;
    try {
      await api.deleteDevice(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete device");
    }
  }

  const columns: Column<Device>[] = [
    {
      key: "serialNumber",
      header: "Serial number",
      sortable: true,
      render: (d) => <code className="mono">{d.serialNumber}</code>,
    },
    { key: "label", header: "Label", sortable: true, render: (d) => d.label ?? <span className="muted">—</span> },
    ...(isSuperAdmin
      ? [
          {
            key: "company",
            header: "Company",
            sortable: true,
            render: (d: Device) => <CompanyName name={d.company?.name} />,
          },
        ]
      : []),
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (d) => <span className={`badge badge-${d.status.toLowerCase()}`}>{d.status}</span>,
    },
    {
      key: "lastSeenAt",
      header: "Last seen",
      sortable: true,
      render: (d) => (d.lastSeenAt ? formatDateTime(d.lastSeenAt) : <span className="muted">never</span>),
    },
    {
      key: "webhook",
      header: "Webhook",
      // Configured/enabled indicator only - never the URL itself, even masked,
      // to keep this list from doubling as a place webhook endpoints leak into view.
      render: (d) =>
        d.webhookUrlMasked ? (
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
        ),
    },
    {
      key: "actions",
      header: "",
      cellClassName: "actions-cell",
      render: (d) => (
        <>
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
        </>
      ),
    },
  ];

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

      <div className="card">
        <DataTable
          columns={columns}
          rows={table.rows}
          rowKey={(d) => d.id}
          loading={table.loading}
          sort={table.sort}
          onSort={table.toggleSort}
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          emptyMessage={
            <>
              No devices found. Click <Link to="/unregistered-devices">+ Add device</Link> to connect one.
            </>
          }
          searchValue={table.searchInput}
          onSearchChange={table.setSearchInput}
          searchPlaceholder="Search serial, label or company…"
          toolbar={
            <>
              <select
                className="datatable-filter"
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="ONLINE">Online</option>
                <option value="OFFLINE">Offline</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
              {isSuperAdmin && (
                <select
                  className="datatable-filter"
                  aria-label="Filter by company"
                  value={companyFilter}
                  onChange={(e) => setCompanyFilter(e.target.value)}
                >
                  <option value="">All companies</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          }
        />
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
