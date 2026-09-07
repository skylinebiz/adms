import { formatDateTime } from "./dateFormat";

// Punch timestamps are stored as the device's literal wall-clock digits
// stamped as UTC (see parseDeviceDatetime in src/adms/parsers/attlog.ts) -
// they are NOT a real UTC instant, just a deterministic encoding of
// whatever local time the device's clock was set to. Formatting them with
// the *viewer's* local timezone would shift the displayed time away from
// what the device actually showed, so this forces UTC extraction to render
// the same digits back out verbatim, regardless of the admin's browser
// timezone. The display format itself (date/time shape) still follows the
// admin's saved preference - see dateFormat.ts.
export function formatPunchTime(iso: string): string {
  return formatDateTime(iso, { utc: true });
}

// punchTimeUtc is a real UTC instant (only present once a device has a
// configured timezone - see Device.timezone) - format it in the viewer's
// own local timezone, unlike formatPunchTime above which deliberately does
// not.
export function formatAccurateTime(iso: string | null): string {
  if (!iso) return "—";
  return formatDateTime(iso, { utc: false });
}
