import { describe, expect, it } from "vitest";
import { computeRetentionCutoff, DEFAULT_DATA_RETENTION_DAYS, MAX_DATA_RETENTION_DAYS, MIN_DATA_RETENTION_DAYS } from "../src/utils/retention";

describe("computeRetentionCutoff", () => {
  it("subtracts exactly N whole days from the reference time", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    expect(computeRetentionCutoff(30, now)).toEqual(new Date("2026-07-21T12:00:00.000Z"));
    expect(computeRetentionCutoff(1, now)).toEqual(new Date("2026-08-19T12:00:00.000Z"));
    expect(computeRetentionCutoff(10, now)).toEqual(new Date("2026-08-10T12:00:00.000Z"));
  });

  it("defaults `now` to the current time when not given", () => {
    const before = Date.now();
    const cutoff = computeRetentionCutoff(1);
    const after = Date.now();
    const expectedMs = 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - expectedMs);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - expectedMs);
  });

  it("exported constants match the documented default/bounds", () => {
    expect(DEFAULT_DATA_RETENTION_DAYS).toBe(30);
    expect(MIN_DATA_RETENTION_DAYS).toBe(1);
    expect(MAX_DATA_RETENTION_DAYS).toBeGreaterThan(0);
  });
});
