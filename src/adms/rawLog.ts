import { NextFunction, Request, Response } from "express";
import { prisma } from "../db/client";
import { deviceLogger } from "../logger";

const MAX_STORED_BODY = 10000;

function truncate(value: string | undefined | null): string | null {
  if (!value) return null;
  return value.length > MAX_STORED_BODY ? value.slice(0, MAX_STORED_BODY) : value;
}

// Unconditional firehose: logs *every* /iclock/* request (any SN, any
// table, registered or not) to RawRequestLog for super-admin debugging.
// Never throws and never blocks the device response on failure - a logging
// hiccup must not turn into a device-facing error.
export async function logRawRequest(req: Request, _res: Response, next: NextFunction) {
  const sn = typeof req.query.SN === "string" ? req.query.SN : undefined;
  try {
    await prisma.rawRequestLog.create({
      data: {
        serialNumber: sn || null,
        endpoint: req.path,
        method: req.method,
        query: JSON.stringify(req.query),
        headers: JSON.stringify(req.headers),
        rawBody: truncate(typeof req.body === "string" ? req.body : undefined),
      },
    });
  } catch (err) {
    deviceLogger.error({ err }, "failed to persist raw request log");
  }
  next();
}

// Curated per-device dump: anything a *registered* device pushes to
// /iclock/cdata that isn't ATTLOG (OPERLOG, USERINFO, FINGERTMP, FACE,
// photos, or any other table name a firmware variant sends).
//
// Unlike logRawRequest above, this one is real device data we're supposed
// to be storing (not just an ancillary debug log), so it deliberately does
// NOT swallow its own errors - the caller (handleCdataPost) classifies the
// failure via classifyDbError and decides whether to withhold the ack
// (transient - let the device retry) or still ack `OK` (a genuinely
// unstorable payload, where retrying would just fail identically forever).
export async function logDeviceRawData(
  req: Request,
  deviceId: string,
  table: string | undefined,
  rawBody: string
) {
  await prisma.deviceRawLog.create({
    data: {
      deviceId,
      endpoint: req.path,
      method: req.method,
      table: table || null,
      query: JSON.stringify(req.query),
      headers: JSON.stringify(req.headers),
      rawBody: truncate(rawBody),
    },
  });
}
