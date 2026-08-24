import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, PlatformSettings } from "../api";

const MIN_DAYS = 1;
const MAX_DAYS = 3650;
const MIN_ATTEMPTS = 1;
const MAX_ATTEMPTS = 50;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120_000;

export default function Settings() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [dataRetentionDays, setDataRetentionDays] = useState("");
  const [webhookMaxAttempts, setWebhookMaxAttempts] = useState("");
  const [webhookTimeoutMs, setWebhookTimeoutMs] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [retentionSuccess, setRetentionSuccess] = useState(false);
  const [retentionSaving, setRetentionSaving] = useState(false);

  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [webhookSuccess, setWebhookSuccess] = useState(false);
  const [webhookSaving, setWebhookSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setSettings(settings);
        setDataRetentionDays(String(settings.dataRetentionDays));
        setWebhookMaxAttempts(String(settings.webhookMaxAttempts));
        setWebhookTimeoutMs(String(settings.webhookTimeoutMs));
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmitRetention(e: FormEvent) {
    e.preventDefault();
    setRetentionError(null);
    setRetentionSuccess(false);
    const days = Number(dataRetentionDays);
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
      setRetentionError(`Enter a whole number of days between ${MIN_DAYS} and ${MAX_DAYS}`);
      return;
    }
    setRetentionSaving(true);
    try {
      const { settings } = await api.updateSettings({ dataRetentionDays: days });
      setSettings(settings);
      setDataRetentionDays(String(settings.dataRetentionDays));
      setRetentionSuccess(true);
    } catch (err) {
      setRetentionError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setRetentionSaving(false);
    }
  }

  async function onSubmitWebhook(e: FormEvent) {
    e.preventDefault();
    setWebhookError(null);
    setWebhookSuccess(false);
    const attempts = Number(webhookMaxAttempts);
    const timeoutMs = Number(webhookTimeoutMs);
    if (!Number.isInteger(attempts) || attempts < MIN_ATTEMPTS || attempts > MAX_ATTEMPTS) {
      setWebhookError(`Enter a whole number of attempts between ${MIN_ATTEMPTS} and ${MAX_ATTEMPTS}`);
      return;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
      setWebhookError(`Enter a whole number of milliseconds between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
      return;
    }
    setWebhookSaving(true);
    try {
      const { settings } = await api.updateSettings({ webhookMaxAttempts: attempts, webhookTimeoutMs: timeoutMs });
      setSettings(settings);
      setWebhookMaxAttempts(String(settings.webhookMaxAttempts));
      setWebhookTimeoutMs(String(settings.webhookTimeoutMs));
      setWebhookSuccess(true);
    } catch (err) {
      setWebhookError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setWebhookSaving(false);
    }
  }

  return (
    <div>
      <h2>Settings</h2>
      <p className="muted">Platform-wide configuration — applies across every company, super admin only.</p>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : loadError ? (
        <div className="error-banner">{loadError}</div>
      ) : (
        <>
          <div className="card" style={{ maxWidth: 520, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Data retention</h3>
            <p className="muted">
              Punch/attendance records (and their webhook delivery history), raw request/device logs,
              unregistered-device ping logs, and device command history older than this many days are{" "}
              <strong>permanently deleted</strong> by the background worker, once an hour. This includes real
              attendance data — there is no undo. Companies, devices, and admin accounts are never affected.
            </p>
            <form onSubmit={onSubmitRetention}>
              {retentionError && <div className="error-banner">{retentionError}</div>}
              {retentionSuccess && <div className="notice-banner">Saved.</div>}
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
              <button className="btn btn-primary" type="submit" disabled={retentionSaving}>
                {retentionSaving ? "Saving…" : "Save"}
              </button>
            </form>
          </div>

          <div className="card" style={{ maxWidth: 520, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Webhook delivery</h3>
            <p className="muted">
              How hard the background worker tries to deliver each punch's webhook before giving up (shown as
              "failed" in the admin panel), and how long it waits for a response on each attempt. Applies to every
              company's webhooks — there's no per-device override.
            </p>
            <form onSubmit={onSubmitWebhook}>
              {webhookError && <div className="error-banner">{webhookError}</div>}
              {webhookSuccess && <div className="notice-banner">Saved.</div>}
              <div className="form-row">
                <div className="field">
                  <label>Max attempts</label>
                  <input
                    type="number"
                    min={MIN_ATTEMPTS}
                    max={MAX_ATTEMPTS}
                    step={1}
                    value={webhookMaxAttempts}
                    onChange={(e) => setWebhookMaxAttempts(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>Per-attempt timeout (ms)</label>
                  <input
                    type="number"
                    min={MIN_TIMEOUT_MS}
                    max={MAX_TIMEOUT_MS}
                    step={100}
                    value={webhookTimeoutMs}
                    onChange={(e) => setWebhookTimeoutMs(e.target.value)}
                    required
                  />
                </div>
              </div>
              <button className="btn btn-primary" type="submit" disabled={webhookSaving}>
                {webhookSaving ? "Saving…" : "Save"}
              </button>
            </form>
          </div>

          {settings && (
            <p className="muted">Last changed: {new Date(settings.updatedAt).toLocaleString()}</p>
          )}
        </>
      )}
    </div>
  );
}
