import { Request, Response } from "express";
import { Device } from "@prisma/client";
import { prisma } from "../db/client";
import { deviceLogger } from "../logger";

// A deliberate exception to this codebase's "always ack OK" rule: a
// request for an already-registered device with a missing/invalid secret
// is a real rejection, not a soft drop. Never call this for the
// still-unregistered/pending case - see sendUnclaimed below for that one.
export function sendRejected(res: Response) {
  res.status(401).type("text/plain; charset=UTF-8").send("Unauthorized");
}

// The other deliberate exception: a *data-bearing* request (a punch batch,
// a devicecmd ack) for an SN that isn't a registered Device yet. Acking OK
// here would mean silently discarding whatever data came with the request
// forever - once a device is later claimed, only *new* data from that
// point on gets processed, so there's no way to recover this after the
// fact. 503 tells the device (accurately) "try again later" - it stays
// true until an admin claims it, and the device backs off and retries on
// its own schedule. Never call this for the registration/discovery flow
// (GET cdata handshake, getrequest, test) - those keep acking OK
// unconditionally so an unclaimed device stays in a healthy poll loop and
// keeps re-announcing itself instead of possibly giving up entirely.
export function sendUnclaimed(res: Response) {
  res.status(503).type("text/plain; charset=UTF-8").send("Service Unavailable");
}

export async function findDeviceBySerial(serialNumber: string) {
  if (!serialNumber) return null;
  return prisma.device.findUnique({ where: { serialNumber } });
}

// Best-effort: a transient failure updating lastSeenAt/status must never
// block the actual request handling that comes after it (e.g. storing a
// punch batch that would otherwise have succeeded fine on its own).
export async function touchDevice(deviceId: string) {
  try {
    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(), status: "ONLINE" },
    });
  } catch (err) {
    deviceLogger.error({ err, deviceId }, "failed to update device last-seen/status (best-effort, not fatal)");
  }
}

// Pure decision: does this request's path secret satisfy the device's
// configured secret? Every device now has a mandatory secret (see
// Device.deviceSecret) - this is a plain exact match, no "unsecured -
// trust anything" case left to handle.
export function isDeviceRequestTrusted(deviceSecret: string, secretFromPath: string | undefined): boolean {
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
//     see upsertPendingDevice's isNew), and always resolves as untrusted.
//     The company slug never affects trust for an already-registered
//     device below - only SN + per-device secret do. Callers on the
//     registration/discovery flow (handshake, getrequest, test) still ack
//     `OK` unconditionally for this case; callers on a data-bearing
//     endpoint (a punch batch, a devicecmd ack) must withhold the ack
//     instead - see sendUnclaimed.
//   - Device found, secret matches the path -> trusted.
//   - Device found, secret missing/mismatched -> NOT trusted. Callers must
//     reject this outright (401, sendRejected), not ack OK - this protects
//     a real, already-registered device rather than one still finding its
//     feet.
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
