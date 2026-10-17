import { FormEvent, useEffect, useState } from "react";
import { api, AdminUserSummary, ApiError, CompanyOption } from "../api";
import { useAuth } from "../context/AuthContext";
import DataTable, { Column } from "../components/DataTable";
import { useDataTable } from "../hooks/useDataTable";
import { KeyRound, Trash2 } from "lucide-react";
import IconButton from "../components/IconButton";

export default function AdminUsers() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [roleFilter, setRoleFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [actionError, setError] = useState<string | null>(null);

  const table = useDataTable<AdminUserSummary>({
    fetcher: async (q) => {
      const r = await api.listAdminUsers({
        ...q,
        role: roleFilter || undefined,
        companyId: companyFilter || undefined,
      });
      return { rows: r.adminUsers, total: r.total };
    },
    defaultSort: { sortBy: "createdAt", sortDir: "desc" },
    deps: [roleFilter, companyFilter],
    errorMessage: "Failed to load admin users",
  });
  const error = actionError ?? table.error;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"SUPER_ADMIN" | "COMPANY_ADMIN">("COMPANY_ADMIN");
  const [companyId, setCompanyId] = useState("");
  const [creating, setCreating] = useState(false);

  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  useEffect(() => {
    api.listCompanyOptions().then((c) => {
      setCompanies(c.companies);
      setCompanyId((current) => current || c.companies[0]?.id || "");
    });
  }, []);

  const load = table.reload;

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api.createAdminUser({
        email,
        password,
        role,
        companyId: role === "SUPER_ADMIN" ? null : companyId,
      });
      setEmail("");
      setPassword("");
      table.setPage(1);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create admin user");
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this admin user?")) return;
    try {
      await api.deleteAdminUser(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete admin user");
    }
  }

  async function onResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    try {
      await api.resetAdminUserPassword(resetTarget, resetPassword);
      setResetTarget(null);
      setResetPassword("");
      alert("Password reset. The user will be prompted to change it on next login.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reset password");
    }
  }

  const columns: Column<AdminUserSummary>[] = [
    { key: "email", header: "Email", sortable: true, render: (u) => u.email },
    {
      key: "role",
      header: "Role",
      sortable: true,
      render: (u) => (u.role === "SUPER_ADMIN" ? "Super admin" : "Company admin"),
    },
    {
      key: "company",
      header: "Company",
      sortable: true,
      render: (u) => companies.find((c) => c.id === u.companyId)?.name ?? "—",
    },
    {
      key: "actions",
      header: "",
      cellClassName: "actions-cell",
      render: (u) => (
        <>
          {user?.role === "SUPER_ADMIN" && (
            <IconButton icon={KeyRound} label="Reset password" onClick={() => setResetTarget(u.id)} />
          )}
          {user?.role === "SUPER_ADMIN" && u.id !== user.id && (
            <IconButton icon={Trash2} label="Delete" variant="danger" onClick={() => onDelete(u.id)} />
          )}
        </>
      ),
    },
  ];

  return (
    <div>
      <h2>Admin Users</h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <h3>New admin user</h3>
        <form onSubmit={onCreate}>
          <div className="form-row">
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>Temporary password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
          </div>
          <div className="form-row">
            {user?.role === "SUPER_ADMIN" && (
              <div className="field">
                <label>Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value as any)}>
                  <option value="COMPANY_ADMIN">Company admin</option>
                  <option value="SUPER_ADMIN">Super admin</option>
                </select>
              </div>
            )}
            {role === "COMPANY_ADMIN" && (
              <div className="field">
                <label>Company</label>
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button className="btn btn-primary" type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create admin user"}
          </button>
        </form>
      </div>

      <div className="card">
        <DataTable
          columns={columns}
          rows={table.rows}
          rowKey={(u) => u.id}
          loading={table.loading}
          sort={table.sort}
          onSort={table.toggleSort}
          page={table.page}
          pageSize={table.pageSize}
          total={table.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          emptyMessage="No admin users found."
          searchValue={table.searchInput}
          onSearchChange={table.setSearchInput}
          searchPlaceholder="Search email or company…"
          toolbar={
            <>
              {user?.role === "SUPER_ADMIN" && (
                <select
                  className="datatable-filter"
                  aria-label="Filter by role"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                >
                  <option value="">All roles</option>
                  <option value="SUPER_ADMIN">Super admin</option>
                  <option value="COMPANY_ADMIN">Company admin</option>
                </select>
              )}
              {user?.role === "SUPER_ADMIN" && (
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

      {resetTarget && (
        <div className="modal-overlay" onClick={() => setResetTarget(null)}>
          <div className="modal-drawer" style={{ width: 360 }} onClick={(e) => e.stopPropagation()}>
            <h3>Reset password</h3>
            <form onSubmit={onResetPassword}>
              <div className="field">
                <label>New temporary password</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  minLength={8}
                  required
                  autoFocus
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" type="submit">
                  Reset
                </button>
                <button className="btn" type="button" onClick={() => setResetTarget(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
