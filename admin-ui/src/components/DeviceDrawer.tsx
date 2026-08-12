import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError, CompanyOption, Device, TestWebhookResult } from "../api";

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

export default function DeviceDrawer({ deviceId, mode, companies, defaultCompanyId, onClose, onSaved }: Props) {
  const [device, setDevice] = useState<Device | null>(null);
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? companies[0]?.id ?? "");
  const [serialNumber, setSerialNumber] = useState("");
  const [label, setLabel] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
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

  useEffect(() => {
    if (mode === "edit" && deviceId) {
      api.getDevice(deviceId).then(({ device }) => {
        setDevice(device);
        setCompanyId(device.companyId);
        setLabel(device.label ?? "");
        setWebhookUrl(device.webhookUrl ?? "");
        setWebhookEnabled(device.webhookEnabled);
        setHeaderRows(headersToRows(device.webhookHeaders));
        if (device.webhookBodyTemplate) {
          setUseCustomBody(true);
          setBodyTemplateText(JSON.stringify(device.webhookBodyTemplate, null, 2));
        }
      });
    }
  }, [mode, deviceId]);

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
          webhookUrl: webhookUrl || undefined,
          webhookEnabled,
          webhookHeaders,
          webhookBodyTemplate: bodyTemplate,
        });
      } else if (deviceId) {
        await api.updateDevice(deviceId, {
          label,
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
