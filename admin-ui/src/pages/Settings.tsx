import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, PlatformSettings } from "../api";
import {
  DATE_FORMAT_OPTIONS,
  DateFormatId,
  formatDateTime,
  getDateFormatPreference,
  getTimeFormatPreference,
  setDateFormatPreference,
  setTimeFormatPreference,
  TIME_FORMAT_OPTIONS,
  TimeFormatId,
} from "../utils/dateFormat";

const MIN_DAYS = 1;
const MAX_DAYS = 3650;
const MIN_ATTEMPTS = 1;
const MAX_ATTEMPTS = 50;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120_000;

export default function Settings() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [signupsEnabled, setSignupsEnabled] = useState(true);
  const [dataRetentionDays, setDataRetentionDays] = useState("");
  const [webhookMaxAttempts, setWebhookMaxAttempts] = useState("");
  const [webhookTimeoutMs, setWebhookTimeoutMs] = useState("");
  // UI-only display preference - stored in this browser's localStorage
  // (see utils/dateFormat.ts), never sent to the server. Applies to every
  // date/time shown across the admin panel, not just this page.
  const [savedDateFormat, setSavedDateFormat] = useState<DateFormatId>(getDateFormatPreference());
  const [savedTimeFormat, setSavedTimeFormat] = useState<TimeFormatId>(getTimeFormatPreference());
  const [dateFormat, setDateFormat] = useState<DateFormatId>(savedDateFormat);
  const [timeFormat, setTimeFormat] = useState<TimeFormatId>(savedTimeFormat);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  function applyServerSettings(s: PlatformSettings) {
    setSettings(s);
    setSignupsEnabled(s.signupsEnabled);
    setDataRetentionDays(String(s.dataRetentionDays));
    setWebhookMaxAttempts(String(s.webhookMaxAttempts));
    setWebhookTimeoutMs(String(s.webhookTimeoutMs));
  }

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => applyServerSettings(settings))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  const serverDirty =
    settings !== null &&
    (signupsEnabled !== settings.signupsEnabled ||
      dataRetentionDays !== String(settings.dataRetentionDays) ||
      webhookMaxAttempts !== String(settings.webhookMaxAttempts) ||
      webhookTimeoutMs !== String(settings.webhookTimeoutMs));
  const displayDirty = dateFormat !== savedDateFormat || timeFormat !== savedTimeFormat;
  const dirty = serverDirty || displayDirty;

  // Any edit clears the previous "Saved" confirmation.
  function edit<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setSaved(false);
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const days = Number(dataRetentionDays);
    const attempts = Number(webhookMaxAttempts);
    const timeoutMs = Number(webhookTimeoutMs);
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
      setError(`Retention period must be a whole number of days between ${MIN_DAYS} and ${MAX_DAYS}`);
      return;
    }
    if (!Number.isInteger(attempts) || attempts < MIN_ATTEMPTS || attempts > MAX_ATTEMPTS) {
      setError(`Max attempts must be a whole number between ${MIN_ATTEMPTS} and ${MAX_ATTEMPTS}`);
      return;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
      setError(`Timeout must be a whole number of milliseconds between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
      return;
    }

    setSaving(true);
    try {
      if (serverDirty) {
        const { settings } = await api.updateSettings({
          signupsEnabled,
          dataRetentionDays: days,
          webhookMaxAttempts: attempts,
          webhookTimeoutMs: timeoutMs,
        });
        applyServerSettings(settings);
      }
      if (displayDirty) {
        setDateFormatPreference(dateFormat);
        setTimeFormatPreference(timeFormat);
        setSavedDateFormat(dateFormat);
        setSavedTimeFormat(timeFormat);
      }
      setSaved(true);
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
      ) : loadError ? (
        <div className="error-banner">{loadError}</div>
      ) : (
        <form className="card settings-card" onSubmit={onSubmit}>
          <section className="settings-section">
            <div className="settings-section-head">
              <h3>Public signups</h3>
              <p className="muted">
                Let anyone create a new company from the signup page. When off, only a super admin can create
                companies. Existing companies are not affected.
              </p>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={signupsEnabled}
                onChange={(e) => edit(setSignupsEnabled)(e.target.checked)}
              />
              Allow public signups
            </label>
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <h3>Data retention</h3>
              <p className="muted">
                Punches (and their webhook history), request/device logs, unregistered-device pings, and device
                command history older than this are <strong>permanently deleted</strong> hourly. Companies,
                devices, and admins are never affected.
              </p>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="retention-days">Retention period (days)</label>
                <input
                  id="retention-days"
                  type="number"
                  min={MIN_DAYS}
                  max={MAX_DAYS}
                  step={1}
                  value={dataRetentionDays}
                  onChange={(e) => edit(setDataRetentionDays)(e.target.value)}
                  required
                />
              </div>
              <div className="field" aria-hidden />
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <h3>Webhook delivery</h3>
              <p className="muted">
                How many times each punch's webhook is attempted before it's marked "failed", and how long each
                attempt waits for a response. Applies to every company.
              </p>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="webhook-attempts">Max attempts</label>
                <input
                  id="webhook-attempts"
                  type="number"
                  min={MIN_ATTEMPTS}
                  max={MAX_ATTEMPTS}
                  step={1}
                  value={webhookMaxAttempts}
                  onChange={(e) => edit(setWebhookMaxAttempts)(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="webhook-timeout">Per-attempt timeout (ms)</label>
                <input
                  id="webhook-timeout"
                  type="number"
                  min={MIN_TIMEOUT_MS}
                  max={MAX_TIMEOUT_MS}
                  step={100}
                  value={webhookTimeoutMs}
                  onChange={(e) => edit(setWebhookTimeoutMs)(e.target.value)}
                  required
                />
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <h3>Date &amp; time display</h3>
              <p className="muted">
                Display-only preference saved in this browser. Doesn't change stored data or affect other admins.
              </p>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="date-format">Date format</label>
                <select
                  id="date-format"
                  value={dateFormat}
                  onChange={(e) => edit(setDateFormat)(e.target.value as DateFormatId)}
                >
                  {DATE_FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="time-format">Time format</label>
                <select
                  id="time-format"
                  value={timeFormat}
                  onChange={(e) => edit(setTimeFormat)(e.target.value as TimeFormatId)}
                >
                  {TIME_FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="muted settings-preview">
              Preview: {formatDateTime(new Date(), { dateFormat, timeFormat })}
            </p>
          </section>

          {error && <div className="error-banner">{error}</div>}

          <div className="settings-footer">
            <span className="muted">
              {saved ? (
                <span className="success-text">Settings saved.</span>
              ) : dirty ? (
                "You have unsaved changes."
              ) : settings ? (
                `Last changed: ${formatDateTime(settings.updatedAt)}`
              ) : null}
            </span>
            <button className="btn btn-primary" type="submit" disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
