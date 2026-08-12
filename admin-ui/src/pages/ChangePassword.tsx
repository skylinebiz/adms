import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";

export default function ChangePassword() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("New password and confirmation do not match");
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      await refresh();
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setTimeout(() => navigate("/"), 1000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2>Change Password</h2>
      {user?.mustChangePassword && (
        <div className="notice-banner">
          This account was created with a temporary password. Please set a new password to continue.
        </div>
      )}
      <div className="card" style={{ maxWidth: 420 }}>
        <form onSubmit={onSubmit}>
          {error && <div className="error-banner">{error}</div>}
          {success && <div className="notice-banner">Password changed successfully.</div>}
          <div className="field">
            <label>Current password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>New password (min 8 characters)</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Change password"}
          </button>
        </form>
      </div>
    </div>
  );
}
