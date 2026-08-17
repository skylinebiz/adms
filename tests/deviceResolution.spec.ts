import { describe, expect, it } from "vitest";
import { isDeviceRequestTrusted } from "../src/adms/deviceLookup";

// deviceSecret is mandatory on every Device now (no more "never secured -
// trust anything" branch), so there's no null-secret case left to cover.
describe("isDeviceRequestTrusted", () => {
  it("trusts a request whose path secret matches the device's secret exactly", () => {
    expect(isDeviceRequestTrusted("abc123", "abc123")).toBe(true);
  });

  it("does not trust a secured device hit on the plain path (no secret at all)", () => {
    expect(isDeviceRequestTrusted("abc123", undefined)).toBe(false);
  });

  it("does not trust a secured device hit with the wrong secret", () => {
    expect(isDeviceRequestTrusted("abc123", "wrong")).toBe(false);
  });

  it("secret comparison is case-sensitive and exact", () => {
    expect(isDeviceRequestTrusted("abc123", "ABC123")).toBe(false);
    expect(isDeviceRequestTrusted("abc123", "abc123 ")).toBe(false);
  });
});

// computeNextPendingSecret/computeNextPendingCompanyId were retired when
// upsertPendingDevice moved from read-then-write to database-level
// compare-and-set (see deviceLookup.ts) - the first-write-wins invariant
// they encoded now lives in `WHERE ... IS NULL` guards on the UPDATE
// statements themselves, not in application-level pure functions, so
// there's no longer a pure decision to unit test here. The behavior is
// covered by the end-to-end verification instead.
