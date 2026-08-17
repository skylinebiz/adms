import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError, CompanyOption, Device, DeviceCommandLog, TestWebhookResult, WebhookTemplate } from "../api";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS } from "../utils/timezoneOptions";

interface Props {
  deviceId: string | null;
  mode: "create" | "edit";
  companies: CompanyOption[];
  defaultCompanyId?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface HeaderRow {
  key: string;
  value: string;
}

const PLACEHOLDERS = [
  "pin",
  "punch_time",
  "punch_time_unix",
  "punch_time_utc",
  "device_timezone",
  "punch_time_frappe",
  "status",
  "verify_mode",
  "work_code",
  "device_id",
  "device_serial",
  "company_id",
  "company_name",
  "received_at",
];

const STARTER_BODY_TEMPLATE = JSON.stringify(
  {
    employee_id: "{{pin}}",
    timestamp: "{{punch_time}}",
    event_type: "{{status}}",
  },
  null,
  2
);

function headersToRows(headers: Record<string, string> | null | undefined): HeaderRow[] {
  if (!headers) return [];
  return Object.entries(headers).map(([key, value]) => ({ key, value }));
}

function rowsToHeaders(rows: HeaderRow[]): Record<string, string> | null {
  const obj: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) obj[row.key.trim()] = row.value;
  }
  return Object.keys(obj).length ? obj : null;
}

// Client-side convenience only - the value that ends up in the field is
// what actually gets saved and configured on the device, so it doesn't
// need to come from the server the way webhookSecret does.
function generateRandomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function DeviceDrawer({ deviceId, mode, companies, defaultCompanyId, onClose, onSaved }: Props) {
  const [device, setDevice] = useState<Device | null>(null);
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? companies[0]?.id ?? "");
  // Prefer the device's own joined company (edit mode, always accurate)
  // over a lookup by the currently-selected companyId (create mode, or
  // before the device has loaded) - both should normally agree.
  const selectedCompanySlug = device?.company?.slug ?? companies.find((c) => c.id === companyId)?.slug ?? "";
  const [serialNumber, setSerialNumber] = useState("");
  const [label, setLabel] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [deviceSecret, setDeviceSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  // Mandatory on every device now - default to IST as a starting point
  // for create mode (this deployment's primary operating timezone), still
  // freely changeable before saving.
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([]);
  const [useCustomBody, setUseCustomBody] = useState(false);
  const [bodyTemplateText, setBodyTemplateText] = useState(STARTER_BODY_TEMPLATE);
  const [bodyTemplateError, setBodyTemplateError] = useState<string | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestWebhookResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [commandText, setCommandText] = useState("");
  const [sendingCommand, setSendingCommand] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commands, setCommands] = useState<DeviceCommandLog[]>([]);
  const [loadingCommands, setLoadingCommands] = useState(false);

  const [webhookTemplates, setWebhookTemplates] = useState<WebhookTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  useEffect(() => {
    api.listWebhookTemplates().then(({ templates }) => setWebhookTemplates(templates));
  }, []);

  function onSelectTemplate(id: string) {
    setSelectedTemplateId(id);
    if (!id) return; // "Custom" - leave whatever's currently in the fields alone.
    const tmpl = webhookTemplates.find((t) => t.id === id);
    if (!tmpl) return;
    setWebhookUrl(tmpl.urlPlaceholder);
    setHeaderRows(headersToRows(tmpl.headers));
    setUseCustomBody(true);
    setBodyTemplateText(JSON.stringify(tmpl.bodyTemplate, null, 2));
    setBodyTemplateError(null);
  }

  function loadCommands() {
    if (!deviceId) return;
    setLoadingCommands(true);
    api
      .listDeviceCommands(deviceId)
      .then(({ commands }) => setCommands(commands))
      .finally(() => setLoadingCommands(false));
  }

  useEffect(() => {
    if (mode === "edit" && deviceId) {
      api.getDevice(deviceId).then(({ device }) => {
        setDevice(device);
        setCompanyId(device.companyId);
        setLabel(device.label ?? "");
        setWebhookUrl(device.webhookUrl ?? "");
        setWebhookEnabled(device.webhookEnabled);
        setDeviceSecret(device.deviceSecret ?? "");
        setTimezone(device.timezone);
        setHeaderRows(headersToRows(device.webhookHeaders));
        if (device.webhookBodyTemplate) {
          setUseCustomBody(true);
          setBodyTemplateText(JSON.stringify(device.webhookBodyTemplate, null, 2));
        }
      });
      loadCommands();
    }
  }, [mode, deviceId]);

  async function onSendCommand(e: FormEvent) {
    e.preventDefault();
    if (!deviceId || !commandText.trim()) return;
    setCommandError(null);
    setSendingCommand(true);
    try {
      await api.sendDeviceCommand(deviceId, commandText.trim());
      setCommandText("");
      loadCommands();
    } catch (err) {
      setCommandError(err instanceof ApiError ? err.message : "Failed to queue command");
    } finally {
      setSendingCommand(false);
    }
  }

  function validateBodyTemplate(): unknown | null {
    if (!useCustomBody) return null;
    try {
      const parsed = JSON.parse(bodyTemplateText);
      setBodyTemplateError(null);
      return parsed;
    } catch (err) {
      setBodyTemplateError(err instanceof Error ? err.message : "Invalid JSON");
      throw err;
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    let bodyTemplate: unknown | null;
    try {
      bodyTemplate = validateBodyTemplate();
    } catch {
      setError("Fix the request body template before saving - it must be valid JSON.");
      return;
    }

    setSaving(true);
    try {
      const webhookHeaders = rowsToHeaders(headerRows);
      if (mode === "create") {
        await api.createDevice({
          companyId,
          serialNumber,
          label: label || undefined,
          deviceSecret,
          timezone,
          webhookUrl: webhookUrl || undefined,
          webhookEnabled,
          webhookHeaders,
          webhookBodyTemplate: bodyTemplate,
        });
      } else if (deviceId) {
        await api.updateDevice(deviceId, {
          label,
          deviceSecret,
          timezone,
          webhookUrl: webhookUrl || null,
          webhookEnabled,
          webhookHeaders,
          webhookBodyTemplate: bodyTemplate,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save device");
    } finally {
      setSaving(false);
    }
  }

  async function regenerateSecret() {
    if (!deviceId) return;
    if (!confirm("Regenerate the webhook secret? The old secret will stop verifying immediately.")) return;
    const { device } = await api.updateDevice(deviceId, { regenerateSecret: true });
    setDevice(device);
  }

  function insertPlaceholder(name: string) {
    const token = `{{${name}}}`;
    const el = bodyTextareaRef.current;
    if (!el) {
      setBodyTemplateText((t) => t + token);
      return;
    }
    const start = el.selectionStart ?? bodyTemplateText.length;
    const end = el.selectionEnd ?? bodyTemplateText.length;
    const next = bodyTemplateText.slice(0, start) + token + bodyTemplateText.slice(end);
    setBodyTemplateText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function updateHeaderRow(index: number, field: "key" | "value", value: string) {
    setHeaderRows((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function removeHeaderRow(index: number) {
    setHeaderRows((rows) => rows.filter((_, i) => i !== index));
  }

  async function onTestWebhook() {
    if (!deviceId) return;
    setTesting(true);
    setTestError(null);
    setTestResult(null);

    let bodyTemplate: unknown | null;
    try {
      bodyTemplate = validateBodyTemplate();
    } catch {
      setTestError("Fix the request body template before testing - it must be valid JSON.");
      setTesting(false);
      return;
    }

    try {
      const result = await api.testWebhook(deviceId, {
        url: webhookUrl || undefined,
        headers: rowsToHeaders(headerRows),
        bodyTemplate,
      });
      setTestResult(result);
    } catch (err) {
      setTestError(err instanceof ApiError ? err.message : "Failed to send test webhook");
    } finally {
      setTesting(false);
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

          {webhookTemplates.length > 0 && (
            <div className="field">
              <label>Use a template</label>
              <select value={selectedTemplateId} onChange={(e) => onSelectTemplate(e.target.value)}>
                <option value="">Custom (enter everything manually)</option>
                {webhookTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {selectedTemplateId && (
                <div className="card" style={{ marginTop: 8, fontSize: 12 }}>
                  {(() => {
                    const tmpl = webhookTemplates.find((t) => t.id === selectedTemplateId);
                    if (!tmpl) return null;
                    return (
                      <>
                        <div>{tmpl.description}</div>
                        <div className="muted" style={{ marginTop: 6 }}>
                          {tmpl.helpText}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              <div className="muted" style={{ marginTop: 6 }}>
                Prefills the URL, headers, and body template below - all still fully editable. Replace the ALL-CAPS
                placeholder text (your site URL, API key, etc.) with your real values before saving.
              </div>
            </div>
          )}

          <div className="field">
            <label>Webhook URL</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://example.com/webhooks/punches"
            />
          </div>
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={webhookEnabled}
                onChange={(e) => setWebhookEnabled(e.target.checked)}
                style={{ width: "auto", marginRight: 6 }}
              />
              Webhook enabled
            </label>
          </div>

          {mode === "edit" && device?.webhookSecret && (
            <div className="field">
              <label>Webhook secret (HMAC-SHA256)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input readOnly value={showSecret ? device.webhookSecret : "•".repeat(24)} />
                <button type="button" className="btn btn-sm" onClick={() => setShowSecret((v) => !v)}>
                  {showSecret ? "Hide" : "Show"}
                </button>
              </div>
              <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={regenerateSecret}>
                Regenerate secret
              </button>
            </div>
          )}

          <div className="field">
            <label>Custom headers</label>
            {headerRows.map((row, i) => (
              <div key={i} className="form-row" style={{ marginBottom: 6 }}>
                <input
                  placeholder="Header name (e.g. Authorization)"
                  value={row.key}
                  onChange={(e) => updateHeaderRow(i, "key", e.target.value)}
                />
                <input
                  placeholder="Value (placeholders allowed)"
                  value={row.value}
                  onChange={(e) => updateHeaderRow(i, "value", e.target.value)}
                />
                <button type="button" className="btn btn-sm" onClick={() => removeHeaderRow(i)}>
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setHeaderRows((rows) => [...rows, { key: "", value: "" }])}
            >
              + Add header
            </button>
          </div>

          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={useCustomBody}
                onChange={(e) => setUseCustomBody(e.target.checked)}
                style={{ width: "auto", marginRight: 6 }}
              />
              Use a custom request body
            </label>
            <div className="muted" style={{ marginBottom: 8 }}>
              {useCustomBody
                ? "Sent exactly as written below, with placeholders substituted."
                : "Off = sends the default punch.created JSON shape (documented in the README)."}
            </div>

            {useCustomBody && (
              <>
                <div style={{ marginBottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {PLACEHOLDERS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="btn btn-sm"
                      onClick={() => insertPlaceholder(name)}
                      title={`Insert {{${name}}} at cursor`}
                    >
                      {`{{${name}}}`}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={bodyTextareaRef}
                  value={bodyTemplateText}
                  onChange={(e) => {
                    setBodyTemplateText(e.target.value);
                    setBodyTemplateError(null);
                  }}
                  rows={10}
                  style={{
                    width: "100%",
                    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                    fontSize: 12,
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid #d0d5dd",
                  }}
                />
                {bodyTemplateError && <div className="error-banner" style={{ marginTop: 6 }}>{bodyTemplateError}</div>}
                <div className="muted" style={{ marginTop: 6 }}>
                  A field that's exactly <code className="mono">{"{{status}}"}</code> becomes a JSON number/string in
                  its real type; a placeholder inside a longer string (e.g.{" "}
                  <code className="mono">{"\"Punch by {{pin}}\""}</code>) is substituted as text.
                </div>
              </>
            )}
          </div>

          {mode === "edit" && (
            <div className="field">
              <button type="button" className="btn" onClick={onTestWebhook} disabled={testing}>
                {testing ? "Sending…" : "Send test webhook"}
              </button>
              <div className="muted" style={{ marginTop: 6 }}>
                Sends a realistic sample punch to the URL/headers/body above (using this device's real ID/serial and
                company name) without saving anything or touching real punch data.
              </div>

              {testError && <div className="error-banner" style={{ marginTop: 8 }}>{testError}</div>}

              {testResult && (
                <div className="card" style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>Test result</strong>
                    <span className={`badge ${testResult.result.success ? "badge-delivered" : "badge-failed"}`}>
                      {testResult.result.success ? "success" : "failed"}
                    </span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    Status code: {testResult.result.statusCode ?? <span className="muted">n/a</span>}
                  </div>
                  {testResult.result.error && (
                    <div className="error-banner" style={{ marginTop: 6 }}>
                      {testResult.result.error}
                    </div>
                  )}
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer" }}>Request body sent</summary>
                    <pre
                      style={{
                        background: "var(--neutral-tint)",
                        color: "var(--text)",
                        padding: 8,
                        borderRadius: 6,
                        fontSize: 11,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        maxHeight: 160,
                        overflow: "auto",
                      }}
                    >
                      {JSON.stringify(testResult.sentBody, null, 2)}
                    </pre>
                  </details>
                  {testResult.result.responseBody && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer" }}>Response body</summary>
                      <pre
                        style={{
                          background: "var(--neutral-tint)",
                          color: "var(--text)",
                          padding: 8,
                          borderRadius: 6,
                          fontSize: 11,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          maxHeight: 160,
                          overflow: "auto",
                        }}
                      >
                        {testResult.result.responseBody}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === "edit" && deviceId && (
            <div className="field">
              <label>Send raw ADMS command</label>
              <div className="muted" style={{ marginBottom: 6 }}>
                Queues a raw command for this device's next{" "}
                <code className="mono">/iclock/getrequest</code> poll, delivered as{" "}
                <code className="mono">C:&lt;id&gt;:&lt;command&gt;</code>. Diagnostic tool - there's no complete
                public spec for this protocol, so this is often the only way to find out what a given firmware
                actually understands. Whether/how the device responds shows up below once it polls again.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={commandText}
                  onChange={(e) => setCommandText(e.target.value)}
                  placeholder="e.g. SET OPTIONS DateTime=1786968000"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={onSendCommand}
                  disabled={sendingCommand || !commandText.trim()}
                >
                  {sendingCommand ? "Queuing…" : "Send"}
                </button>
              </div>
              {commandError && (
                <div className="error-banner" style={{ marginTop: 8 }}>
                  {commandError}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                <strong style={{ fontSize: 13 }}>Recent commands</strong>
                <button type="button" className="btn btn-sm" onClick={loadCommands} disabled={loadingCommands}>
                  {loadingCommands ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              {commands.length === 0 ? (
                <div className="muted" style={{ marginTop: 6 }}>
                  No commands sent to this device yet.
                </div>
              ) : (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                  {commands.map((c) => (
                    <div
                      key={c.id}
                      className="card"
                      style={{ padding: 8, fontSize: 12 }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <code className="mono" style={{ wordBreak: "break-all" }}>
                          {c.command}
                        </code>
                        <span className={`badge badge-${c.status.toLowerCase()}`}>{c.status}</span>
                      </div>
                      <div className="muted" style={{ marginTop: 4 }}>
                        Queued {new Date(c.createdAt).toLocaleString()}
                        {c.ackedAt ? ` · ACKed ${new Date(c.ackedAt).toLocaleString()}` : ""}
                      </div>
                      {c.response && (
                        <div
                          className="mono"
                          style={{
                            marginTop: 4,
                            background: "var(--neutral-tint)",
                            padding: 6,
                            borderRadius: 4,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                          }}
                        >
                          {c.response}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
