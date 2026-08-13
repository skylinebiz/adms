import { useEffect, useState } from "react";
import { NavLink, Outlet, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // Close the off-canvas nav whenever the route changes (e.g. after tapping a link).
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <button
          type="button"
          className="nav-toggle"
          aria-label={navOpen ? "Close menu" : "Open menu"}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          {navOpen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
        <span className="brand">ADMS Admin</span>
      </div>

      <div className={`sidebar-backdrop ${navOpen ? "open" : ""}`} onClick={() => setNavOpen(false)} />

      <div className="body-row">
        <aside className={`sidebar ${navOpen ? "open" : ""}`}>
          <h1>ADMS Admin</h1>
          <nav>
            {user.role === "SUPER_ADMIN" && <NavLink to="/companies">Companies</NavLink>}
            <NavLink to="/devices">Devices</NavLink>
            <NavLink to="/unregistered-devices">Unregistered Devices</NavLink>
            <NavLink to="/punch-records">Punch Records</NavLink>
            <NavLink to="/failed-webhooks">Failed Webhooks</NavLink>
            <NavLink to="/raw-data">Raw Data Dump</NavLink>
            {user.role === "SUPER_ADMIN" && <NavLink to="/raw-requests">Raw Request Log</NavLink>}
            <NavLink to="/admin-users">Admin Users</NavLink>
            <NavLink to="/change-password">Change Password</NavLink>
          </nav>
          <div className="user-info">
            <div>{user.email}</div>
            <div>{user.role === "SUPER_ADMIN" ? "Super admin" : "Company admin"}</div>
            <a
              href="#"
              onClick={async (e) => {
                e.preventDefault();
                await logout();
                navigate("/login");
              }}
            >
              Log out
            </a>
          </div>
        </aside>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
