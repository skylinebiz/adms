import { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";

// Guards super-admin-only pages *inside* the routing tree (rather than by
// conditionally registering the <Route> in App.tsx), so a direct/hard
// navigation to the URL doesn't race the async /me check and bounce to "/"
// before `user` has loaded.
export default function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div>
        <h2>Forbidden</h2>
        <p className="muted">This page is only available to super admins.</p>
      </div>
    );
  }
  return <>{children}</>;
}
