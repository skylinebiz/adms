-- Device online/offline status is now computed from lastSeenAt at read
-- time (see computeDeviceStatus in src/utils/deviceStatus.ts) instead of
-- being stored: the stored column was only ever set to 'ONLINE' on
-- contact and never revisited once a device actually went quiet, so it
-- stayed 'ONLINE' forever.
ALTER TABLE "devices" DROP COLUMN "status";
DROP TYPE "DeviceStatus";
