import { describe, expect, it } from "vitest";
import { computeNextPendingSecret, isDeviceRequestTrusted } from "../src/adms/deviceLookup";

describe("isDeviceRequestTrusted", () => {
  it("trusts any request (even with no secret) when the device was never secured", () => {
    expect(isDeviceRequestTrusted(null, undefined)).toBe(true);
    expect(isDeviceRequestTrusted(null, "anything")).toBe(true);
  });

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

describe("computeNextPendingSecret", () => {
  it("adopts whatever secret arrives on first sighting (no prior row)", () => {
    expect(computeNextPendingSecret(undefined, "first-secret")).toBe("first-secret");
  });

  it("adopts a secret when the prior row exists but has none yet", () => {
    expect(computeNextPendingSecret(null, "now-secured")).toBe("now-secured");
  });

  it("stays null when no secret has ever arrived", () => {
    expect(computeNextPendingSecret(undefined, undefined)).toBeNull();
    expect(computeNextPendingSecret(null, undefined)).toBeNull();
  });

  it("keeps the existing secret when a later ping matches it", () => {
    expect(computeNextPendingSecret("known-secret", "known-secret")).toBe("known-secret");
  });

  it("never overwrites an existing secret with a mismatched one", () => {
    expect(computeNextPendingSecret("known-secret", "different-secret")).toBe("known-secret");
  });

  it("never overwrites an existing secret even if the later ping has none", () => {
    expect(computeNextPendingSecret("known-secret", undefined)).toBe("known-secret");
  });
});
