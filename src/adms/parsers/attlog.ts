// Parser for the tab-separated ATTLOG payload body that ZKTeco devices POST to
// /iclock/cdata?table=ATTLOG.
//
// Each line: <PIN>\t<datetime>\t<status>\t<verify-mode>\t<workcode>\t<reserved>\t<reserved>
// Example:   1\t2024-07-28 01:25:24\t0\t1\t\t0\t0

export interface ParsedAttlogLine {
  pin: string;
  punchTime: Date;
  status: number;
  verifyMode: number;
  workCode: string | null;
  reserved1: string | null;
  reserved2: string | null;
  rawLine: string;
}

export interface AttlogParseError {
  rawLine: string;
  error: string;
}

export interface AttlogParseResult {
  records: ParsedAttlogLine[];
  errors: AttlogParseError[];
}

const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

// Devices send local wall-clock time with no timezone info. We treat the
// literal digits as UTC so parsing is deterministic regardless of the
// server's local timezone; callers that need device-local time can convert.
export function parseDeviceDatetime(value: string): Date | null {
  const match = DATETIME_RE.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
  );
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function emptyToNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseAttlogLine(line: string): ParsedAttlogLine {
  const trimmedLine = line.replace(/\r$/, "");
  const fields = trimmedLine.split("\t");

  if (fields.length < 4) {
    throw new Error(`expected at least 4 tab-separated fields, got ${fields.length}`);
  }

  const pin = fields[0].trim();
  if (pin === "") {
    throw new Error("PIN field is empty");
  }

  const punchTime = parseDeviceDatetime(fields[1]);
  if (!punchTime) {
    throw new Error(`unparseable datetime: "${fields[1]}"`);
  }

  const status = Number.parseInt(fields[2], 10);
  if (Number.isNaN(status)) {
    throw new Error(`unparseable status: "${fields[2]}"`);
  }

  const verifyMode = Number.parseInt(fields[3], 10);
  if (Number.isNaN(verifyMode)) {
    throw new Error(`unparseable verify-mode: "${fields[3]}"`);
  }

  return {
    pin,
    punchTime,
    status,
    verifyMode,
    workCode: emptyToNull(fields[4]),
    reserved1: emptyToNull(fields[5]),
    reserved2: emptyToNull(fields[6]),
    rawLine: trimmedLine,
  };
}

// Parses a full ATTLOG request body (possibly many lines). Malformed lines
// are collected as errors rather than thrown, so one bad line never aborts
// the whole batch - the device still gets an "OK" and good lines still land.
export function parseAttlogBody(body: string): AttlogParseResult {
  const records: ParsedAttlogLine[] = [];
  const errors: AttlogParseError[] = [];

  const lines = body.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");

  for (const line of lines) {
    try {
      records.push(parseAttlogLine(line));
    } catch (err) {
      errors.push({ rawLine: line, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { records, errors };
}
