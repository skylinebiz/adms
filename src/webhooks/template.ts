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
  status: 0,
  verify_mode: 1,
  work_code: null,
  device_id: "sample-device-id",
  device_serial: "BOCK200961014",
  company_id: "sample-company-id",
  company_name: "Sample Company",
  received_at: "2026-08-12T12:00:00.000Z",
};
