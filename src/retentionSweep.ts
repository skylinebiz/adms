// The actual data-retention deletion logic, factored out of worker.ts so
// it can be imported (by tests, or anything else) without pulling in
// worker.ts's module-level `main().catch(...)` - importing worker.ts
// itself starts an infinite polling loop as a side effect of the import,
// which is fine for the real worker process but not something a test (or
// any other consumer) should ever trigger by accident.
import { prisma } from "./db/client";
import { appLogger as logger } from "./logger";
import { computeRetentionCutoff, getOrCreatePlatformSettings } from "./utils/retention";

export interface RetentionSweepResult {
  retentionDays: number;
  cutoff: Date;
  deletedPunchRecords: number;
  deletedRawRequestLogs: number;
  deletedDeviceRawLogs: number;
  deletedUnregisteredDevicePings: number;
  deletedDeviceCommands: number;
}

// Deletes rows older than the configured data retention window
// (PlatformSettings.dataRetentionDays, default 30 - see
// src/admin/settings.ts). Punch/attendance records (and, via cascade,
// their webhook delivery history), raw request/device logs, unregistered-
// device ping logs, and device command history are all in scope; Devices,
// Companies, AdminUsers, and PendingDevice (live "not yet claimed" state,
// not historical log data) are never touched.
export async function runRetentionSweep(): Promise<RetentionSweepResult> {
  const settings = await getOrCreatePlatformSettings(prisma);
  const cutoff = computeRetentionCutoff(settings.dataRetentionDays);

  const [punchRecords, rawRequestLogs, deviceRawLogs, unregisteredDevicePings, deviceCommands] = await Promise.all([
    prisma.punchRecord.deleteMany({ where: { receivedAt: { lt: cutoff } } }),
    prisma.rawRequestLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.deviceRawLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.unregisteredDevicePing.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.deviceCommand.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);

  const result: RetentionSweepResult = {
    retentionDays: settings.dataRetentionDays,
    cutoff,
    deletedPunchRecords: punchRecords.count,
    deletedRawRequestLogs: rawRequestLogs.count,
    deletedDeviceRawLogs: deviceRawLogs.count,
    deletedUnregisteredDevicePings: unregisteredDevicePings.count,
    deletedDeviceCommands: deviceCommands.count,
  };

  const totalDeleted =
    result.deletedPunchRecords +
    result.deletedRawRequestLogs +
    result.deletedDeviceRawLogs +
    result.deletedUnregisteredDevicePings +
    result.deletedDeviceCommands;
  if (totalDeleted > 0) {
    logger.info(result, "data retention sweep deleted expired rows");
  }
  return result;
}
