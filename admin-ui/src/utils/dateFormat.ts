// Configurable date/time display formatting - UI-only (localStorage), never
// touches the server. Two independent preferences (date part, time part)
// combine for a full timestamp; either can be used alone (formatDateOnly
// for date-only displays). Defaults to YYYY-MM-DD HH:MM:SS / 24-hour, per
// the admin panel's default display format.

export type DateFormatId = "YYYY-MM-DD" | "DD-MM-YYYY" | "DD/MM/YYYY" | "MM/DD/YYYY";
export type TimeFormatId = "24h" | "12h";

export const DATE_FORMAT_OPTIONS: { id: DateFormatId; label: string }[] = [
  { id: "YYYY-MM-DD", label: "YYYY-MM-DD (2026-09-07)" },
  { id: "DD-MM-YYYY", label: "DD-MM-YYYY (07-09-2026)" },
  { id: "DD/MM/YYYY", label: "DD/MM/YYYY (07/09/2026)" },
  { id: "MM/DD/YYYY", label: "MM/DD/YYYY (09/07/2026)" },
];

export const TIME_FORMAT_OPTIONS: { id: TimeFormatId; label: string }[] = [
  { id: "24h", label: "24-hour (14:05:30)" },
  { id: "12h", label: "12-hour (02:05:30 PM)" },
];

export const DEFAULT_DATE_FORMAT: DateFormatId = "YYYY-MM-DD";
export const DEFAULT_TIME_FORMAT: TimeFormatId = "24h";

const DATE_FORMAT_KEY = "adms.displayDateFormat";
const TIME_FORMAT_KEY = "adms.displayTimeFormat";

function readPreference<T extends string>(key: string, validIds: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored && (validIds as readonly string[]).includes(stored) ? (stored as T) : fallback;
  } catch {
    // localStorage unavailable (private browsing, disabled storage, etc.) -
    // just use the default rather than breaking every date display over it.
    return fallback;
  }
}

export function getDateFormatPreference(): DateFormatId {
  return readPreference(
    DATE_FORMAT_KEY,
    DATE_FORMAT_OPTIONS.map((o) => o.id),
    DEFAULT_DATE_FORMAT
  );
}

export function getTimeFormatPreference(): TimeFormatId {
  return readPreference(
    TIME_FORMAT_KEY,
    TIME_FORMAT_OPTIONS.map((o) => o.id),
    DEFAULT_TIME_FORMAT
  );
}

export function setDateFormatPreference(id: DateFormatId): void {
  try {
    localStorage.setItem(DATE_FORMAT_KEY, id);
  } catch {
    // Preference just won't persist across reloads - not worth surfacing.
  }
}

export function setTimeFormatPreference(id: TimeFormatId): void {
  try {
    localStorage.setItem(TIME_FORMAT_KEY, id);
  } catch {
    // see setDateFormatPreference
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hours: number; // 0-23
  minutes: number;
  seconds: number;
}

// Reads wall-clock digits off a Date, either in UTC or the viewer's local
// timezone - callers pick which via FormatOptions.utc, same distinction
// formatPunchTime/formatAccurateTime in formatTime.ts already relied on
// before this file existed.
function getParts(date: Date, utc: boolean): DateParts {
  return utc
    ? {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hours: date.getUTCHours(),
        minutes: date.getUTCMinutes(),
        seconds: date.getUTCSeconds(),
      }
    : {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hours: date.getHours(),
        minutes: date.getMinutes(),
        seconds: date.getSeconds(),
      };
}

function formatDatePartWith(parts: DateParts, formatId: DateFormatId): string {
  const y = String(parts.year).padStart(4, "0");
  const m = pad2(parts.month);
  const d = pad2(parts.day);
  switch (formatId) {
    case "DD-MM-YYYY":
      return `${d}-${m}-${y}`;
    case "DD/MM/YYYY":
      return `${d}/${m}/${y}`;
    case "MM/DD/YYYY":
      return `${m}/${d}/${y}`;
    case "YYYY-MM-DD":
    default:
      return `${y}-${m}-${d}`;
  }
}

function formatTimePartWith(parts: DateParts, formatId: TimeFormatId): string {
  if (formatId === "12h") {
    const period = parts.hours >= 12 ? "PM" : "AM";
    const hour12 = parts.hours % 12 === 0 ? 12 : parts.hours % 12;
    return `${pad2(hour12)}:${pad2(parts.minutes)}:${pad2(parts.seconds)} ${period}`;
  }
  return `${pad2(parts.hours)}:${pad2(parts.minutes)}:${pad2(parts.seconds)}`;
}

export interface FormatOptions {
  // Extract wall-clock digits in UTC instead of the viewer's local
  // timezone. Default false. See getParts.
  utc?: boolean;
}

// Full date + time, per the admin's saved format preferences (defaults to
// YYYY-MM-DD HH:MM:SS, 24-hour, if none set).
export function formatDateTime(input: string | Date, options: FormatOptions = {}): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const parts = getParts(date, options.utc ?? false);
  return `${formatDatePartWith(parts, getDateFormatPreference())} ${formatTimePartWith(
    parts,
    getTimeFormatPreference()
  )}`;
}

// Date only (no time component), per the admin's saved date format
// preference (defaults to YYYY-MM-DD).
export function formatDateOnly(input: string | Date, options: FormatOptions = {}): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const parts = getParts(date, options.utc ?? false);
  return formatDatePartWith(parts, getDateFormatPreference());
}
