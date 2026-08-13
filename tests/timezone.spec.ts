import { describe, expect, it } from "vitest";
import { isValidTimeZone, zonedWallClockToUtc } from "../src/adms/timezone";

// UTC-getter fields carry the "wall clock digits" input, matching exactly
// how parseDeviceDatetime encodes a device's literal reading.
function wallClock(y: number, mo: number, d: number, h: number, mi: number, s: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

describe("isValidTimeZone", () => {
  it("accepts real IANA zone names", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects made-up or malformed names", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("banana")).toBe(false);
  });
});

describe("zonedWallClockToUtc", () => {
  it("converts a fixed-offset zone (Asia/Kolkata, +05:30, no DST)", () => {
    const result = zonedWallClockToUtc(wallClock(2024, 7, 28, 1, 25, 24), "Asia/Kolkata");
    expect(result.toISOString()).toBe("2024-07-27T19:55:24.000Z");
  });

  it("converts America/New_York in winter (EST, -05:00)", () => {
    const result = zonedWallClockToUtc(wallClock(2024, 1, 15, 10, 0, 0), "America/New_York");
    expect(result.toISOString()).toBe("2024-01-15T15:00:00.000Z");
  });

  it("converts America/New_York in summer (EDT, -04:00) - different offset, same zone", () => {
    const result = zonedWallClockToUtc(wallClock(2024, 7, 15, 10, 0, 0), "America/New_York");
    expect(result.toISOString()).toBe("2024-07-15T14:00:00.000Z");
  });

  it("round-trips through UTC unchanged (zero offset)", () => {
    const result = zonedWallClockToUtc(wallClock(2024, 3, 1, 12, 0, 0), "UTC");
    expect(result.toISOString()).toBe("2024-03-01T12:00:00.000Z");
  });

  it("does not throw inside a DST spring-forward gap (America/New_York, 2024-03-10 02:30 doesn't exist)", () => {
    const result = zonedWallClockToUtc(wallClock(2024, 3, 10, 2, 30, 0), "America/New_York");
    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN(result.getTime())).toBe(false);
  });

  it("does not throw inside a DST fall-back overlap (America/New_York, 2024-11-03 01:30 happens twice)", () => {
    const result = zonedWallClockToUtc(wallClock(2024, 11, 3, 1, 30, 0), "America/New_York");
    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN(result.getTime())).toBe(false);
  });
});
