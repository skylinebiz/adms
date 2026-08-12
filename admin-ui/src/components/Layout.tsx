import { NavLink, Outlet, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>ADMS Admin</h1>
        <nav>
          {user.role === "SUPER_ADMIN" && <NavLink to="/companies">Companies</NavLink>}
          <NavLink to="/devices">Devices</NavLink>
          {user.role === "SUPER_ADMIN" && <NavLink to="/unregistered-devices">Unregistered Devices</NavLink>}
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
  );
}
