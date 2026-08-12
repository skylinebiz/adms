import { Request, Response } from "express";
import { Device } from "@prisma/client";
import { prisma } from "../db/client";
import { deviceLogger } from "../logger";

// The one deliberate exception to this codebase's "always ack OK" rule: a
// request for an already-registered device with a missing/invalid secret
// is a real rejection, not a soft drop. Never call this for the
// still-unregistered/pending case - that one always acks OK.
export function sendRejected(res: Response) {
  res.status(401).type("text/plain; charset=UTF-8").send("Unauthorized");
}

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

// Pure decision: does this request's path secret satisfy the device's
// configured secret? `deviceSecret: null` means "never secured" - fully
// open regardless of what (if anything) the path carried. Otherwise the
// path secret must match exactly; a plain-path request (secretFromPath
// undefined) against a secured device is never trusted.
export function isDeviceRequestTrusted(
  deviceSecret: string | null,
  secretFromPath: string | undefined
): boolean {
  if (deviceSecret === null) return true;
  return deviceSecret === secretFromPath;
}

// Pure decision: what should a pending (not-yet-claimed) SN's stored
// secret become after this ping? A secret already on file is never
// overwritten - even by a mismatch - so nobody can squat/hijack a pending
// SN's identity by pinging it with a different secret. Only "no secret yet
// on file" (no row, or a null one) adopts whatever this ping carried.
export function computeNextPendingSecret(
  existingSecret: string | null | undefined,
  secretFromPath: string | undefined
): string | null {
  if (existingSecret) return existingSecret;
  return secretFromPath ?? null;
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

// Upserts the PendingDevice summary row for a not-yet-claimed SN, applying
// the adopt/no-adopt rule above. Never throws.
async function upsertPendingDevice(serialNumber: string, secretFromPath: string | undefined) {
  if (!serialNumber) return;
  try {
    const existing = await prisma.pendingDevice.findUnique({ where: { serialNumber } });
    const nextSecret = computeNextPendingSecret(existing?.secret, secretFromPath);
    await prisma.pendingDevice.upsert({
      where: { serialNumber },
      create: { serialNumber, secret: nextSecret },
      update: { secret: nextSecret, lastSeenAt: new Date(), pingCount: { increment: 1 } },
    });
  } catch (err) {
    deviceLogger.error({ err, serialNumber }, "failed to upsert pending device");
  }
}

export interface DeviceResolution {
  device: Device | null;
  trusted: boolean;
}

// Central device resolution for every /iclock/* handler that touches
// device-specific data. Lookup is SN-primary (secrets aren't required to be
// unique, so they can never be the lookup key) - the path secret only
// validates the request once a device is found:
//
//   - no Device row for this SN -> still-unregistered/pending. Captures the
//     SN + whatever secret arrived (raw ping log + PendingDevice upsert)
//     and always resolves as untrusted; callers must still ack `OK` for
//     this case (unchanged "always ack OK" convention for the
//     unregistered/pending flow).
//   - Device found, deviceSecret null -> never secured, trusted.
//   - Device found, deviceSecret set and matches the path secret -> trusted.
//   - Device found, deviceSecret set and missing/mismatched -> NOT trusted.
//     Callers must reject this outright (401), not ack OK - this is the one
//     exception to the "always ack OK" convention, since it protects a
//     real, already-registered device rather than a device still finding
//     its feet.
export async function resolveDevice(req: Request, rawBody?: string): Promise<DeviceResolution> {
  const sn = String(req.query.SN ?? "");
  const secretFromPath = req.params.secret as string | undefined;
  const device = await findDeviceBySerial(sn);

  if (device) {
    const trusted = isDeviceRequestTrusted(device.deviceSecret, secretFromPath);
    if (!trusted) {
      deviceLogger.warn(
        { sn, deviceId: device.id, endpoint: req.path },
        "rejected: registered device request missing or invalid secret"
      );
    }
    return { device, trusted };
  }

  await logUnregisteredPing(req, sn, rawBody);
  await upsertPendingDevice(sn, secretFromPath);
  return { device: null, trusted: false };
}
