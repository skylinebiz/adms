import { config } from "../config";

export type ComputedDeviceStatus = "UNKNOWN" | "ONLINE" | "OFFLINE";

// A device's online/offline state is derived from lastSeenAt at read
// time - it is never stored. Storing it (the old approach: touchDevice
// wrote status: "ONLINE" on every contact) meant a device that pinged
// once and then vanished stayed "ONLINE" forever, because nothing ever
// revisited that row afterward to notice the silence and flip it back.
// Deriving it fresh on every read makes that structurally impossible.
export function computeDeviceStatus(lastSeenAt: Date | null, now: Date = new Date()): ComputedDeviceStatus {
  if (!lastSeenAt) return "UNKNOWN";
  const elapsedMs = now.getTime() - lastSeenAt.getTime();
  return elapsedMs <= config.deviceOfflineThresholdMs ? "ONLINE" : "OFFLINE";
}
