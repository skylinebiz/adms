import { FormEvent, useState } from "react";
import { api, ApiError, Company } from "../api";
import { useAuth } from "../context/AuthContext";
import { slugify } from "../utils/slug";
import DataTable, { Column } from "../components/DataTable";
import { useDataTable } from "../hooks/useDataTable";
import { formatDateTime } from "../utils/dateFormat";
import { Trash2 } from "lucide-react";
import IconButton from "../components/IconButton";

export default function Companies() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const [actionError, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [creating, setCreating] = useState(false);

  const table = useDataTable<Company>({
    fetcher: async (q) => {
      const r = await api.listCompanies(q);
      return { rows: r.companies, total: r.total };
    },
    defaultSort: { sortBy: "createdAt", sortDir: "desc" },
    errorMessage: "Failed to load companies",
  });
  const error = actionError ?? table.error;
  const load = table.reload;

  function onNewNameChange(value: string) {
    setNewName(value);
    if (!slugTouched) setNewSlug(slugify(value));
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api.createCompany({ name: newName, slug: newSlug });
      setNewName("");
      setNewSlug("");
      setSlugTouched(false);
      table.setPage(1);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create company");
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this company and all its devices/admins/data? This cannot be undone.")) return;
    try {
      await api.deleteCompany(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete company");
    }
  }

  const columns: Column<Company>[] = [
    { key: "name", header: "Name", sortable: true, render: (c) => c.name },
    { key: "slug", header: "Slug", sortable: true, render: (c) => <code className="mono">{c.slug}</code> },
    { key: "devices", header: "Devices", sortable: true, render: (c) => c._count?.devices ?? "-" },
    { key: "adminUsers", header: "Admin users", sortable: true, render: (c) => c._count?.adminUsers ?? "-" },
    { key: "createdAt", header: "Created", sortable: true, render: (c) => formatDateTime(c.createdAt) },
    ...(isSuperAdmin
      ? [
          {
            key: "actions",
            header: "",
            cellClassName: "actions-cell",
            render: (c: Company) => (
              <IconButton icon={Trash2} label="Delete" variant="danger" onClick={() => onDelete(c.id)} />
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <h2>Companies</h2>
      {error && <div className="error-banner">{error}</div>}

      {isSuperAdmin && (
        <div className="card">
          <h3>New company</h3>
          <form onSubmit={onCreate} className="form-row" style={{ alignItems: "flex-end" }}>
            <div className="field">
              <label>Name</label>
              <input value={newName} onChange={(e) => onNewNameChange(e.target.value)} required />
            </div>
            <div className="field">
              <label>Slug</label>
              <input
                value={newSlug}
                onChange={(e) => {
                  setNewSlug(slugify(e.target.value));
                  setSlugTouched(true);
                }}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                minLength={3}
                maxLength={63}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create company"}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <DataTable
          columns={columns}
          rows={table.rows}
          rowKey={(c) => c.id}
          loading={table.loading}
          sort={table.sort}
          onSort={table.toggleSort}
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          emptyMessage="No companies yet."
          searchValue={isSuperAdmin ? table.searchInput : undefined}
          onSearchChange={isSuperAdmin ? table.setSearchInput : undefined}
          searchPlaceholder="Search name or slug…"
          hidePagination={!isSuperAdmin}
        />
      </div>
    </div>
  );
}
