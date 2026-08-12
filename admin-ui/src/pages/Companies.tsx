import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, Company } from "../api";
import { useAuth } from "../context/AuthContext";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 25;

export default function Companies() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api.listCompanies({ page, pageSize: PAGE_SIZE });
      setCompanies(result.companies);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load companies");
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
      await api.createCompany(newName);
      setNewName("");
      setPage(1);
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

  return (
    <div>
      <h2>Companies</h2>
      {error && <div className="error-banner">{error}</div>}

      {user?.role === "SUPER_ADMIN" && (
        <div className="card">
          <h3>New company</h3>
          <form onSubmit={onCreate} className="form-row" style={{ alignItems: "flex-end" }}>
            <div className="field">
              <label>Name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create company"}
            </button>
          </form>
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
                    <th>Name</th>
                    <th>Devices</th>
                    <th>Admin users</th>
                    <th>Created</th>
                    {user?.role === "SUPER_ADMIN" && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c._count?.devices ?? "-"}</td>
                      <td>{c._count?.adminUsers ?? "-"}</td>
                      <td>{new Date(c.createdAt).toLocaleString()}</td>
                      {user?.role === "SUPER_ADMIN" && (
                        <td>
                          <button className="btn btn-sm btn-danger" onClick={() => onDelete(c.id)}>
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {companies.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No companies yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {user?.role === "SUPER_ADMIN" && (
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
