import { FormEvent, useEffect, useState } from "react";
import { api, AdminUserSummary, ApiError, CompanyOption } from "../api";
import { useAuth } from "../context/AuthContext";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 25;

export default function AdminUsers() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"SUPER_ADMIN" | "COMPANY_ADMIN">("COMPANY_ADMIN");
  const [companyId, setCompanyId] = useState("");
  const [creating, setCreating] = useState(false);

  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [u, c] = await Promise.all([
        api.listAdminUsers({ page, pageSize: PAGE_SIZE }),
        api.listCompanyOptions(),
      ]);
      setUsers(u.adminUsers);
      setTotal(u.total);
      setCompanies(c.companies);
      if (!companyId && c.companies[0]) setCompanyId(c.companies[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load admin users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

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
      setPage(1);
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
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Company</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.role === "SUPER_ADMIN" ? "Super admin" : "Company admin"}</td>
                    <td>{companies.find((c) => c.id === u.companyId)?.name ?? "—"}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      {user?.role === "SUPER_ADMIN" && (
                        <button className="btn btn-sm" onClick={() => setResetTarget(u.id)}>
                          Reset password
                        </button>
                      )}
                      {user?.role === "SUPER_ADMIN" && u.id !== user.id && (
                        <button className="btn btn-sm btn-danger" onClick={() => onDelete(u.id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No admin users found.
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
