// Renders user-configurable webhook headers/body templates. Templates are
// plain JSON where string leaves may contain {{placeholder}} tokens. A leaf
// that is *exactly* "{{name}}" (whitespace-trimmed) is replaced with the
// raw typed value from `vars` (so {{status}} becomes the JSON number 0, not
// the string "0"). A placeholder embedded in a larger string is
// stringified and interpolated in place. Unknown placeholder names are left
// untouched verbatim so a typo is visible in the test-webhook response
// instead of silently disappearing.

export interface PunchTemplateVars {
  pin: string;
  punch_time: string;
  punch_time_unix: number;
  // The real UTC instant, computed from the device's wall-clock digits via
  // its configured timezone (see src/adms/timezone.ts). Unlike punch_time
  // (which is the device's literal digits mislabeled as UTC - see
  // parseDeviceDatetime), this one is an unambiguous, genuinely-UTC ISO8601
  // instant - the "bulletproof" value for downstream systems. Null when the
  // device had no timezone configured at ingestion time, so a receiver can
  // tell "unknown" apart from a real midnight-UTC value instead of silently
  // getting something wrong.
  punch_time_utc: string | null;
  // The device's configured IANA timezone name (e.g. "Asia/Kolkata"), or
  // null if unset. Lets a receiver display punch_time_utc back in the
  // device's own local time without having to know it out of band.
  device_timezone: string | null;
  // punch_time's same literal digits (the device's wall-clock reading,
  // not a real UTC instant - see parseDeviceDatetime), reformatted as
  // "YYYY-MM-DD HH:mm:ss.000000" - the naive-datetime-with-microseconds
  // string Frappe/ERPNext's REST API expects (e.g. for Employee
  // Checkin's `timestamp` field). Exists specifically for the ERPNext
  // webhook template (src/webhooks/templates/erpnext.ts) but usable by
  // any custom template targeting a Frappe-framework app.
  punch_time_frappe: string;
  status: number;
  verify_mode: number;
  work_code: string | null;
  device_id: string;
  device_serial: string;
  company_id: string;
  company_name: string;
  received_at: string;
}

export const PLACEHOLDER_NAMES: (keyof PunchTemplateVars)[] = [
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

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const EXACT_PLACEHOLDER_RE = /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/;

function interpolateString(str: string, vars: Record<string, unknown>): string {
  return str.replace(PLACEHOLDER_RE, (match, name) => {
    if (!(name in vars)) return match;
    const v = vars[name];
    return v === null || v === undefined ? "" : String(v);
  });
}

function renderValue(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = EXACT_PLACEHOLDER_RE.exec(value.trim());
    if (exact && exact[1] in vars) return vars[exact[1]];
    return interpolateString(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((v) => renderValue(v, vars));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderValue(v, vars)]));
  }
  return value;
}

// Renders a JSON body template. `template` may be any JSON-serializable
// value; typically an object. Returns the rendered value unchanged in shape.
export function renderBodyTemplate(template: unknown, vars: PunchTemplateVars): unknown {
  return renderValue(template, vars as unknown as Record<string, unknown>);
}

// Renders custom header values (always plain strings - a header value can
// never become a JSON number, so we always string-interpolate).
export function renderHeaders(
  headers: Record<string, string> | null | undefined,
  vars: PunchTemplateVars
): Record<string, string> {
  if (!headers) return {};
  const rendered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    rendered[key] = interpolateString(String(value), vars as unknown as Record<string, unknown>);
  }
  return rendered;
}

export const SAMPLE_TEMPLATE_VARS: PunchTemplateVars = {
  pin: "1",
  punch_time: "2024-07-28T01:25:24.000Z",
  punch_time_unix: 1722130524,
  punch_time_utc: "2024-07-27T19:55:24.000Z",
  device_timezone: "Asia/Kolkata",
  punch_time_frappe: "2024-07-28 01:25:24.000000",
  status: 0,
  verify_mode: 1,
  work_code: null,
  device_id: "sample-device-id",
  device_serial: "BOCK200961014",
  company_id: "sample-company-id",
  company_name: "Sample Company",
  received_at: "2026-08-12T12:00:00.000Z",
};
