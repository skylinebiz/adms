import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ChangePassword from "./pages/ChangePassword";
import Companies from "./pages/Companies";
import Devices from "./pages/Devices";
import UnregisteredDevices from "./pages/UnregisteredDevices";
import PunchRecords from "./pages/PunchRecords";
import FailedWebhooks from "./pages/FailedWebhooks";
import AdminUsers from "./pages/AdminUsers";
import RawDataDump from "./pages/RawDataDump";
import RawRequestLogPage from "./pages/RawRequestLogPage";
import RequireSuperAdmin from "./components/RequireSuperAdmin";
import { useAuth } from "./context/AuthContext";

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route element={<Layout />}>
        <Route index element={<Navigate to={user?.role === "SUPER_ADMIN" ? "/companies" : "/devices"} replace />} />
        <Route path="change-password" element={<ChangePassword />} />
        <Route path="companies" element={<Companies />} />
        <Route path="devices" element={<Devices />} />
        <Route path="unregistered-devices" element={<UnregisteredDevices />} />
        <Route path="punch-records" element={<PunchRecords />} />
        <Route path="failed-webhooks" element={<FailedWebhooks />} />
        <Route path="admin-users" element={<AdminUsers />} />
        <Route path="raw-data" element={<RawDataDump />} />
        <Route
          path="raw-requests"
          element={
            <RequireSuperAdmin>
              <RawRequestLogPage />
            </RequireSuperAdmin>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
