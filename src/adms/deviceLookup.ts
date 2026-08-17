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

// Resolves the URL's company-slug segment to a real Company.id, or null if
// unresolvable (typo'd slug, stale bookmark, or a reserved word already
// stripped upstream by clearReservedCompanySlug). Never throws.
//
// Case-insensitive: stored slugs are always lowercase (slugSchema rejects
// uppercase at signup/company-create time), but a device's URL is typed by
// a human into a physical keypad - normalizing the incoming segment before
// the lookup means a stray capital letter doesn't silently drop the ping
// into the unscoped bucket.
export async function resolveCompanyIdFromSlug(companySlug: string | undefined): Promise<string | null> {
  if (!companySlug) return null;
  try {
    const company = await prisma.company.findUnique({
      where: { slug: companySlug.toLowerCase() },
      select: { id: true },
    });
    return company?.id ?? null;
  } catch (err) {
    deviceLogger.error({ err, companySlug }, "failed to resolve company slug for pending device");
    return null;
  }
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

// Upserts the PendingDevice summary row for a not-yet-claimed SN. A secret
// or company already on file is never overwritten - even by a mismatch -
// so nobody can squat/hijack a pending SN's identity by pinging it with a
// different secret or from a different company's URL. Never throws.
//
// This used to be a read-then-decide-then-write (find the row, compute
// what the new secret/company should be in application code, then upsert)
// - which is a TOCTOU race: two concurrent first-contact pings for the
// same SN could both read "no row yet", both decide they're the one to
// adopt it, and the second upsert would silently clobber the first's
// secret/company. With self-signup now open to anyone, that's not just a
// theoretical race - it's a way to steal a device's pending identity by
// racing its real first ping.
//
// Fixed by pushing the "first write wins" rule into the database instead
// of application code: createMany+skipDuplicates atomically claims the row
// (a no-op if it already exists), then each of secret/companyId is set via
// its own compare-and-set UPDATE guarded by `WHERE ... IS NULL` - Postgres
// serializes concurrent UPDATEs to the same row, so only one can ever win
// a given field, and the loser's predicate simply no longer matches.
// Returns whether this call is what actually created the row (true only on
// genuine first contact for this SN) - resolveDevice uses this to decide
// whether to also write an UnregisteredDevicePing entry, so a device stuck
// unclaimed doesn't pile up a duplicate log row on every single retry.
async function upsertPendingDevice(
  serialNumber: string,
  secretFromPath: string | undefined,
  resolvedCompanyId: string | null
): Promise<{ isNew: boolean }> {
  if (!serialNumber) return { isNew: false };
  try {
    const created = await prisma.pendingDevice.createMany({
      data: [{ serialNumber, pingCount: 0 }],
      skipDuplicates: true,
    });

    await prisma.pendingDevice.updateMany({
      where: { serialNumber },
      data: { lastSeenAt: new Date(), pingCount: { increment: 1 } },
    });

    if (secretFromPath) {
      await prisma.pendingDevice.updateMany({
        where: { serialNumber, secret: null },
        data: { secret: secretFromPath },
      });
    }

    if (resolvedCompanyId) {
      await prisma.pendingDevice.updateMany({
        where: { serialNumber, companyId: null },
        data: { companyId: resolvedCompanyId },
      });
    }

    return { isNew: created.count > 0 };
  } catch (err) {
    deviceLogger.error({ err, serialNumber }, "failed to upsert pending device");
    return { isNew: false };
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
//     SN + whatever secret arrived, plus the company resolved from the
//     URL's slug segment if any (PendingDevice upsert; a raw
//     UnregisteredDevicePing row too, but only on genuine first contact -
//     see upsertPendingDevice's isNew), and always resolves as untrusted;
//     callers must still ack `OK` for this case (unchanged "always ack OK"
//     convention for the unregistered/pending flow). The company slug
//     never affects trust for an already-registered device below - only
//     SN + per-device secret do.
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

  const companySlug = req.params.companySlug as string | undefined;
  const resolvedCompanyId = await resolveCompanyIdFromSlug(companySlug);
  const { isNew } = await upsertPendingDevice(sn, secretFromPath, resolvedCompanyId);
  // Log the raw ping on genuine first contact (isNew) so an admin can still
  // see exactly what a new SN's first request looked like. A missing SN
  // never gets a PendingDevice row at all (upsertPendingDevice no-ops for
  // it), so `!sn` always logs - that specific noise case is unrelated to
  // this feature and untouched here.
  if (!sn || isNew) {
    await logUnregisteredPing(req, sn, rawBody);
  }
  return { device: null, trusted: false };
}
