import { Request } from "express";
import { prisma } from "../db/client";
import { deviceLogger } from "../logger";

export async function findDeviceBySerial(serialNumber: string) {
  if (!serialNumber) return null;
  return prisma.device.findUnique({ where: { serialNumber } });
}

export async function touchDevice(deviceId: string) {
  await prisma.device.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date(), status: "ONLINE" },
  });
}

// Records a raw ping from an SN that isn't (yet) registered as a Device, so
// an admin can later "claim" it into a company. Never throws - logging
// failures must never break the device's response.
export async function logUnregisteredPing(req: Request, serialNumber: string, rawBody?: string) {
  deviceLogger.warn(
    { serialNumber, endpoint: req.path, method: req.method, query: req.query },
    "ping from unregistered device SN"
  );
  try {
    await prisma.unregisteredDevicePing.create({
      data: {
        serialNumber: serialNumber || "(missing)",
        endpoint: req.path,
        method: req.method,
        query: JSON.stringify(req.query),
        rawBody: rawBody ? rawBody.slice(0, 10000) : null,
      },
    });
  } catch (err) {
    deviceLogger.error({ err }, "failed to persist unregistered device ping");
  }
}
