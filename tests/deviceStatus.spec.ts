import { describe, expect, it } from "vitest";
import { computeDeviceStatus } from "../src/utils/deviceStatus";
import { config } from "../src/config";

describe("computeDeviceStatus", () => {
  const now = new Date("2026-08-17T12:00:00Z");

  it("is UNKNOWN when the device has never been seen", () => {
    expect(computeDeviceStatus(null, now)).toBe("UNKNOWN");
  });

  it("is ONLINE when last seen within the threshold", () => {
    const lastSeenAt = new Date(now.getTime() - config.deviceOfflineThresholdMs / 2);
    expect(computeDeviceStatus(lastSeenAt, now)).toBe("ONLINE");
  });

  it("is ONLINE exactly at the threshold boundary", () => {
    const lastSeenAt = new Date(now.getTime() - config.deviceOfflineThresholdMs);
    expect(computeDeviceStatus(lastSeenAt, now)).toBe("ONLINE");
  });

  it("is OFFLINE once the threshold has elapsed", () => {
    const lastSeenAt = new Date(now.getTime() - config.deviceOfflineThresholdMs - 1);
    expect(computeDeviceStatus(lastSeenAt, now)).toBe("OFFLINE");
  });

  it("stays OFFLINE indefinitely for a device silent since long ago - never reverts to ONLINE on its own", () => {
    const lastSeenAt = new Date(now.getTime() - config.deviceOfflineThresholdMs * 100);
    expect(computeDeviceStatus(lastSeenAt, now)).toBe("OFFLINE");
  });
});
