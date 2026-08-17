// Shared by DeviceDrawer (create/edit) and UnregisteredDevices (claim) -
// both need the same "pick an IANA timezone" dropdown.

// A modest hand-picked fallback for the rare browser without
// Intl.supportedValuesOf, so the select still has real options rather than
// being stuck with none.
const FALLBACK_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Moscow",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function listTimeZones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
      "timeZone"
    );
    return supported && supported.length > 0 ? supported : FALLBACK_TIMEZONES;
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

// Current UTC offset in minutes for `tz` (positive = ahead of UTC). Used
// only to sort/label the picker - approximate for DST zones (based on
// today's date), not the ingestion-time conversion logic.
function currentOffsetMinutes(tz: string): number {
  // Both the formatting and the subtraction below must read the same
  // instant, at the same (seconds-included) precision - formatting to
  // minute precision while subtracting a full-precision Date.now() loses
  // up to 59s, which Math.round then silently rounds down to the wrong
  // minute (e.g. Kolkata's exact +05:30 showing as +05:29).
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - now.getTime()) / 60000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${h}:${m}`;
}

export interface TimezoneOption {
  tz: string;
  label: string;
  offsetMinutes: number;
}

// Sorted by offset (west to east) then name, so zones sharing an offset are
// still easy to scan - e.g. all the UTC+05:30 zones sit together.
function buildTimezoneOptions(): TimezoneOption[] {
  return listTimeZones()
    .map((tz) => {
      const offsetMinutes = currentOffsetMinutes(tz);
      return { tz, offsetMinutes, label: `(${formatOffset(offsetMinutes)}) ${tz}` };
    })
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.tz.localeCompare(b.tz));
}

export const TIMEZONE_OPTIONS = buildTimezoneOptions();

// Sensible default for the picker - IST, since that's this deployment's
// primary operating timezone. Still just a starting point; always
// changeable before saving/claiming.
//
// Resolved against the actual option list rather than hardcoded: IANA
// treats "Asia/Kolkata" as an alias of the canonical "Asia/Calcutta", and
// depending on the ICU version bundled with the browser/Node runtime,
// Intl.supportedValuesOf("timeZone") may only return one of the two - a
// hardcoded name that doesn't match any real <option> would silently
// fall back to the browser's default (the first option in the list,
// nowhere near IST) instead of erroring, so this always resolves to
// whichever spelling is actually present.
export const DEFAULT_TIMEZONE =
  TIMEZONE_OPTIONS.find((opt) => opt.tz === "Asia/Kolkata" || opt.tz === "Asia/Calcutta")?.tz ?? "UTC";
