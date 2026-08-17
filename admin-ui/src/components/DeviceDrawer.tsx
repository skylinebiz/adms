import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, CompanyOption, Device } from "../api";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS } from "../utils/timezoneOptions";

interface Props {
  deviceId: string | null;
  mode: "create" | "edit";
  companies: CompanyOption[];
  defaultCompanyId?: string;
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

// Device *definition* only - serial number, label, secret, timezone.
// Webhook config and the raw command tool each have their own dedicated
// drawer now (WebhookDrawer, DeviceCommandsDrawer), opened directly from
// the Devices list, since this form was getting congested carrying all
// three at once. Both of those only make sense for an already-existing
// device, so neither ever belonged in create mode anyway.
export default function DeviceDrawer({ deviceId, mode, companies, defaultCompanyId, onClose, onSaved }: Props) {
  const [device, setDevice] = useState<Device | null>(null);
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? companies[0]?.id ?? "");
  // Prefer the device's own joined company (edit mode, always accurate)
  // over a lookup by the currently-selected companyId (create mode, or
  // before the device has loaded) - both should normally agree.
  const selectedCompanySlug = device?.company?.slug ?? companies.find((c) => c.id === companyId)?.slug ?? "";
  const [serialNumber, setSerialNumber] = useState("");
  const [label, setLabel] = useState("");
  const [deviceSecret, setDeviceSecret] = useState("");
  // Mandatory on every device now - default to IST as a starting point
  // for create mode (this deployment's primary operating timezone), still
  // freely changeable before saving.
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === "edit" && deviceId) {
      api.getDevice(deviceId).then(({ device }) => {
        setDevice(device);
        setCompanyId(device.companyId);
        setLabel(device.label ?? "");
        setDeviceSecret(device.deviceSecret ?? "");
        setTimezone(device.timezone);
      });
    }
  }, [mode, deviceId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (mode === "create") {
        await api.createDevice({ companyId, serialNumber, label: label || undefined, deviceSecret, timezone });
      } else if (deviceId) {
        await api.updateDevice(deviceId, { label, deviceSecret, timezone });
      }
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
        <h3>{mode === "create" ? "Register device" : `Device: ${device?.serialNumber ?? ""}`}</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={onSubmit}>
          {mode === "create" && (
            <>
              <div className="field">
                <label>Company</label>
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Serial number (SN)</label>
                <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} required />
              </div>
            </>
          )}
          <div className="field">
            <label>Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Front Door" />
          </div>

          {mode === "edit" && device && (
            <div className="field">
              <label>Status</label>
              <div>
                <span className={`badge badge-${device.status.toLowerCase()}`}>{device.status}</span>{" "}
                <span className="muted">
                  {device.lastSeenAt ? `last seen ${new Date(device.lastSeenAt).toLocaleString()}` : "never seen"}
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
            {deviceSecret && (
              <div style={{ marginTop: 8 }}>
                <label>Cloud Server URL</label>
                <input
                  readOnly
                  value={
                    selectedCompanySlug
                      ? `${window.location.origin}/${selectedCompanySlug}/${deviceSecret}`
                      : "(select a company to see the full URL)"
                  }
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
