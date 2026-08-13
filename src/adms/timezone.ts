// Converts a device's literal wall-clock digits (see parseDeviceDatetime in
// parsers/attlog.ts, which stamps those digits as UTC purely as a
// deterministic encoding - not a real instant) into the actual UTC instant
// they represent, given the IANA timezone the device's clock is set to.

// Rejects anything Intl can't resolve as a real IANA zone (garbage strings,
// typos, made-up names). "UTC" itself is valid and resolves to zero offset.
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

// offset(instant, tz) = (what wall-clock digits `tz` shows for `instant`,
// read back as if those digits were themselves UTC ms) - instant.getTime().
// For a zone ahead of UTC (e.g. +05:30) this is positive; behind UTC,
// negative. Standard relationship: trueUtcInstant = wallClockDigits - offset.
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asIfUtc - instant.getTime();
}

// `wallClockDigits` carries the device's literal wall-clock reading in its
// own UTC-getter fields (exactly how parseDeviceDatetime encodes them) -
// this function treats those fields as local time *in* `timeZone` and
// returns the real UTC instant. Standard two-pass fixed-point approach:
// offsets change slowly enough (at most ~1-2h, only at DST transitions)
// that one refinement pass is enough outside the transition hour itself;
// inside a spring-forward gap or fall-back overlap the result is one of the
// two valid interpretations rather than an error - an inherent ambiguity of
// the calendar, not a bug.
export function zonedWallClockToUtc(wallClockDigits: Date, timeZone: string): Date {
  const guessMs = Date.UTC(
    wallClockDigits.getUTCFullYear(),
    wallClockDigits.getUTCMonth(),
    wallClockDigits.getUTCDate(),
    wallClockDigits.getUTCHours(),
    wallClockDigits.getUTCMinutes(),
    wallClockDigits.getUTCSeconds()
  );

  const offset1 = offsetMs(new Date(guessMs), timeZone);
  const estimate = guessMs - offset1;
  const offset2 = offsetMs(new Date(estimate), timeZone);
  const finalMs = offset2 === offset1 ? estimate : guessMs - offset2;

  return new Date(finalMs);
}
