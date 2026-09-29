import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, CompanyOption, Device } from "../api";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS } from "../utils/timezoneOptions";
import { formatDateTime } from "../utils/dateFormat";

interface Props {
  deviceId: string;
  companies: CompanyOption[];
  onClose: () => void;
  onSaved: () => void;
}

// Client-side convenience only - the value that ends up in the field is
// what actually gets saved and configured on the device, so it doesn't
// need to come from the server the way webhookSecret does.
function generateRandomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Edits an existing device's *definition* only - label, secret, timezone.
// Webhook config and the raw command tool each have their own dedicated
// drawer (WebhookDrawer, DeviceCommandsDrawer), opened directly from the
// Devices list.
//
// Edit-only since v2.16.0: the admin panel no longer has a manual
// "Register device" form. The one supported way to add a device is to
// point it at the Cloud Server URL, let it ping, and claim it from
// Unregistered Devices - two parallel paths kept confusing admins about
// which one to use. POST /api/admin/devices itself still exists for
// scripted/emergency use; there's just no UI for it.
export default function DeviceDrawer({ deviceId, companies, onClose, onSaved }: Props) {
  const [device, setDevice] = useState<Device | null>(null);
  const [label, setLabel] = useState("");
  const [deviceSecret, setDeviceSecret] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // GET /devices/:id's joined company carries no slug, so fall back to
  // the company options list (which always does) to build the URL.
  const companySlug =
    device?.company?.slug ?? companies.find((c) => c.id === device?.companyId)?.slug ?? "";

  useEffect(() => {
    api.getDevice(deviceId).then(({ device }) => {
      setDevice(device);
      setLabel(device.label ?? "");
      setDeviceSecret(device.deviceSecret ?? "");
      setTimezone(device.timezone);
    });
  }, [deviceId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.updateDevice(deviceId, { label, deviceSecret, timezone });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save device");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Device: {device?.serialNumber ?? ""}</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Front Door" />
          </div>

          {device && (
            <div className="field">
              <label>Status</label>
              <div>
                <span className={`badge badge-${device.status.toLowerCase()}`}>{device.status}</span>{" "}
                <span className="muted">
                  {device.lastSeenAt ? `last seen ${formatDateTime(device.lastSeenAt)}` : "never seen"}
                </span>
              </div>
            </div>
          )}

          <div className="field">
            <label>Device secret</label>
            <div className="muted" style={{ marginBottom: 6 }}>
              Required - whatever you put in this device's own COMM → Cloud Server Setting URL. Any request claiming
              this device's serial number without the matching secret is rejected outright.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={deviceSecret} onChange={(e) => setDeviceSecret(e.target.value)} required />
              <button type="button" className="btn btn-sm" onClick={() => setDeviceSecret(generateRandomSecret())}>
                Generate
              </button>
            </div>
            {deviceSecret && companySlug && (
              <div style={{ marginTop: 8 }}>
                <label>Cloud Server URL</label>
                <input
                  readOnly
                  value={`${window.location.origin}/${companySlug}/${deviceSecret}`}
                  onFocus={(e) => e.target.select()}
                />
              </div>
            )}
          </div>

          <div className="field">
            <label>Device timezone</label>
            <div className="muted" style={{ marginBottom: 6 }}>
              The IANA timezone this device's clock is set to (e.g. "Asia/Kolkata"). Required - used to compute an
              accurate UTC timestamp for every punch, and sent to the device itself in the ADMS handshake response
              (see README) so firmware that resets its own clock on connect gets told what it should actually be.
            </div>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} required>
              {TIMEZONE_OPTIONS.map((opt) => (
                <option key={opt.tz} value={opt.tz}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn" type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
