// Punch timestamps are stored as the device's literal wall-clock digits
// stamped as UTC (see parseDeviceDatetime in src/adms/parsers/attlog.ts) -
// they are NOT a real UTC instant, just a deterministic encoding of
// whatever local time the device's clock was set to. Formatting them with
// the *viewer's* local timezone (the default for toLocaleString) would
// shift the displayed time away from what the device actually showed, so
// this forces UTC output to render the same digits back out verbatim,
// regardless of the admin's browser timezone.
export function formatPunchTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { timeZone: "UTC" });
}
