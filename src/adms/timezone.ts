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

// The reverse of zonedWallClockToUtc: given a real UTC instant, returns a
// Date whose own UTC-getter fields equal the wall-clock digits `timeZone`
// shows for that instant. No ambiguity refinement needed here (unlike the
// other direction) - going instant -> zoned digits is a single
// deterministic Intl lookup.
export function zonedWallClockNow(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")));
}

// offset(instant, tz) = zonedWallClockNow(tz, instant) - instant. For a
// zone ahead of UTC (e.g. +05:30) this is positive; behind UTC, negative.
// Standard relationship: trueUtcInstant = wallClockDigits - offset.
function offsetMs(instant: Date, timeZone: string): number {
  return zonedWallClockNow(timeZone, instant).getTime() - instant.getTime();
}

// The ADMS PUSH protocol's optional `TimeZone=` handshake field: tells the
// device what to set its own clock/timezone to, directly in the handshake
// response - no queued command, no response-header trickery. Confirmed
// working (not just documented) against the reference project this
// codebase mirrors protocol behavior from - it ships the field
// commented-out by default (github.com/saifulcoder/adms-server-ZKTeco,
// iclockController, `// "TimeZone=7\r\n"`), and multiple users in that
// project's issue tracker report uncommenting it fixed the exact "clock
// resets on connect" problem this exists for.
//
// Two encodings show up across firmware docs with no single authoritative
// spec to resolve them, so this hedges: a whole-hour offset is sent as a
// plain signed hour integer (e.g. "7" for GMT+7 - the exact form in the
// confirmed-working example above); a fractional offset (e.g. IST's
// +05:30, Nepal's +05:45) is sent as total signed minutes (e.g. "330"),
// since no firmware documentation found supports a fractional-hour form.
// The whole-hour case has field confirmation; the fractional-minutes case
// does not yet - verify on real hardware before relying on it for a
// half/quarter-hour zone.
export function computeTimeZoneOptionValue(timeZone: string, now: Date = new Date()): string {
  const offsetMinutes = Math.round((zonedWallClockNow(timeZone, now).getTime() - now.getTime()) / 60000);
  return offsetMinutes % 60 === 0 ? String(offsetMinutes / 60) : String(offsetMinutes);
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
