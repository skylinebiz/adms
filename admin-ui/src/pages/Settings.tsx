import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, PlatformSettings } from "../api";

const MIN_DAYS = 1;
const MAX_DAYS = 3650;

export default function Settings() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [dataRetentionDays, setDataRetentionDays] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setSettings(settings);
        setDataRetentionDays(String(settings.dataRetentionDays));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const days = Number(dataRetentionDays);
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
      setError(`Enter a whole number of days between ${MIN_DAYS} and ${MAX_DAYS}`);
      return;
    }
    setSaving(true);
    try {
      const { settings } = await api.updateSettings({ dataRetentionDays: days });
      setSettings(settings);
      setDataRetentionDays(String(settings.dataRetentionDays));
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>Settings</h2>
      <p className="muted">Platform-wide configuration — applies across every company, super admin only.</p>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="card" style={{ maxWidth: 520 }}>
          <h3 style={{ marginTop: 0 }}>Data retention</h3>
          <p className="muted">
            Punch/attendance records (and their webhook delivery history), raw request/device logs,
            unregistered-device ping logs, and device command history older than this many days are{" "}
            <strong>permanently deleted</strong> by the background worker, once an hour. This includes real
            attendance data — there is no undo. Companies, devices, and admin accounts are never affected.
          </p>
          <form onSubmit={onSubmit}>
            {error && <div className="error-banner">{error}</div>}
            {success && <div className="notice-banner">Saved.</div>}
            <div className="field">
              <label>Retention period (days)</label>
              <input
                type="number"
                min={MIN_DAYS}
                max={MAX_DAYS}
                step={1}
                value={dataRetentionDays}
                onChange={(e) => setDataRetentionDays(e.target.value)}
                required
                style={{ maxWidth: 160 }}
              />
            </div>
            {settings && (
              <p className="muted" style={{ marginTop: -4 }}>
                Last changed: {new Date(settings.updatedAt).toLocaleString()}
              </p>
            )}
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
