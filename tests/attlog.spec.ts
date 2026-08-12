import { describe, expect, it } from "vitest";
import { parseAttlogBody, parseAttlogLine, parseDeviceDatetime } from "../src/adms/parsers/attlog";

describe("parseDeviceDatetime", () => {
  it("parses a valid device datetime as UTC wall-clock", () => {
    const date = parseDeviceDatetime("2024-07-28 01:25:24");
    expect(date).not.toBeNull();
    expect(date!.toISOString()).toBe("2024-07-28T01:25:24.000Z");
  });

  it("returns null for garbage input", () => {
    expect(parseDeviceDatetime("not-a-date")).toBeNull();
    expect(parseDeviceDatetime("")).toBeNull();
  });
});

describe("parseAttlogLine", () => {
  it("parses a well-formed line with empty workcode", () => {
    const line = "1\t2024-07-28 01:25:24\t0\t1\t\t0\t0";
    const record = parseAttlogLine(line);
    expect(record.pin).toBe("1");
    expect(record.status).toBe(0);
    expect(record.verifyMode).toBe(1);
    expect(record.workCode).toBeNull();
    expect(record.reserved1).toBe("0");
    expect(record.reserved2).toBe("0");
    expect(record.punchTime.toISOString()).toBe("2024-07-28T01:25:24.000Z");
    expect(record.rawLine).toBe(line);
  });

  it("parses a different pin and card verify mode", () => {
    const record = parseAttlogLine("4\t2024-07-28 10:41:31\t0\t1\t\t0\t0");
    expect(record.pin).toBe("4");
    expect(record.verifyMode).toBe(1);
  });

  it("handles \\r\\n line endings on a single line", () => {
    const record = parseAttlogLine("1\t2024-07-28 01:25:24\t0\t1\t\t0\t0\r");
    expect(record.rawLine).toBe("1\t2024-07-28 01:25:24\t0\t1\t\t0\t0");
  });

  it("throws on too few fields", () => {
    expect(() => parseAttlogLine("1\t2024-07-28 01:25:24\t0")).toThrow(/at least 4/);
  });

  it("throws on empty PIN", () => {
    expect(() => parseAttlogLine("\t2024-07-28 01:25:24\t0\t1\t\t0\t0")).toThrow(/PIN/);
  });

  it("throws on unparseable datetime", () => {
    expect(() => parseAttlogLine("1\tnot-a-date\t0\t1\t\t0\t0")).toThrow(/datetime/);
  });

  it("throws on unparseable status", () => {
    expect(() => parseAttlogLine("1\t2024-07-28 01:25:24\tX\t1\t\t0\t0")).toThrow(/status/);
  });

  it("throws on unparseable verify-mode", () => {
    expect(() => parseAttlogLine("1\t2024-07-28 01:25:24\t0\tX\t\t0\t0")).toThrow(/verify-mode/);
  });
});

describe("parseAttlogBody", () => {
  const sampleBody = [
    "1\t2024-07-28 01:25:24\t0\t1\t\t0\t0",
    "1\t2024-07-28 10:41:21\t0\t1\t\t0\t0",
    "4\t2024-07-28 10:41:31\t0\t1\t\t0\t0",
  ].join("\r\n");

  it("parses all sample lines from the spec", () => {
    const result = parseAttlogBody(sampleBody);
    expect(result.records).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.records.map((r) => r.pin)).toEqual(["1", "1", "4"]);
  });

  it("skips blank lines without producing errors", () => {
    const result = parseAttlogBody(`${sampleBody}\r\n\r\n\n`);
    expect(result.records).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it("isolates a malformed line as an error without dropping good lines", () => {
    const body = [
      "1\t2024-07-28 01:25:24\t0\t1\t\t0\t0",
      "garbage-line-not-enough-fields",
      "4\t2024-07-28 10:41:31\t0\t1\t\t0\t0",
    ].join("\r\n");
    const result = parseAttlogBody(body);
    expect(result.records).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rawLine).toBe("garbage-line-not-enough-fields");
  });

  it("handles fingerprint (1), card (4) and face (15) verify modes", () => {
    const body = [
      "1\t2024-07-28 01:25:24\t0\t1\t\t0\t0",
      "2\t2024-07-28 01:26:00\t1\t4\t\t0\t0",
      "3\t2024-07-28 01:27:00\t0\t15\t\t0\t0",
    ].join("\n");
    const result = parseAttlogBody(body);
    expect(result.records.map((r) => r.verifyMode)).toEqual([1, 4, 15]);
  });

  it("returns empty records/errors for an empty body", () => {
    const result = parseAttlogBody("");
    expect(result.records).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
