import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { deviceLogger } from "../logger";
import { resolveDevice, sendRejected, sendUnclaimed, touchDevice } from "./deviceLookup";
import { parseAttlogBody } from "./parsers/attlog";
import { logDeviceRawData } from "./rawLog";
import { zonedWallClockToUtc } from "./timezone";
import { classifyDbError } from "./dbErrors";

const OK = "OK";

function sendPlainText(res: Response, body: string, status = 200) {
  res.status(status).type("text/plain; charset=UTF-8").send(body);
}

// The one thing every "did we actually store what the device sent" path
// needs to report: whether the device's next retry (if any) is warranted.
// `stored: false` always means "withhold the ack, let the device retry" -
// callers never see *why*, since the response to the device is identical
// either way (a plain 500, no ack) and the reasoning lives in the logs.
interface StoreResult {
  stored: boolean;
}

function buildOptionsResponse(): string {
  const lines = [
    "GET OPTION FROM: SN",
    "ATTLOGStamp=9999",
    "OPERLOGStamp=9999",
    "ErrorDelay=60",
    "Delay=30",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=1111111111",
    "Realtime=1",
    "Encrypt=0",
  ];
  return lines.join("\n") + "\n";
}

// GET /iclock/cdata - device handshake / heartbeat / config pull.
export async function handleCdataGet(req: Request, res: Response) {
  const sn = String(req.query.SN ?? "");
  deviceLogger.info({ sn, query: req.query }, "cdata GET (handshake)");

  const { device, trusted } = await resolveDevice(req);
  if (device && !trusted) {
    sendRejected(res);
    return;
  }
  if (device) {
    await touchDevice(device.id);
  }
  // device === null: still-unregistered/pending, already captured inside
  // resolveDevice - falls through to the normal OK handshake response.

  sendPlainText(res, buildOptionsResponse());
}

// Stores a batch of parsed ATTLOG records as a single atomic multi-row
// INSERT (createMany + skipDuplicates, relying on the existing
// [deviceId, devicePin, punchTime, status, verifyMode] unique constraint
// for dedup) - either the whole batch lands or none of it does, so a
// crash or DB error partway through can never leave a half-written batch
// behind. If that single statement fails, the response depends on *why*:
//
//   - a connection/unknown error (DB unreachable, pool exhausted, etc.) is
//     transient - report `stored: false` so the caller withholds the ack
//     and the device retries the identical batch later.
//   - a data error (e.g. a NUL byte embedded in a line, which Postgres
//     refuses to store in a text column) means retrying the identical
//     batch would fail identically forever. Falls back to inserting one
//     record at a time so only the actual offending line(s) get skipped
//     (loudly logged) instead of losing - or permanently wedging on - the
//     rest of an otherwise-good batch.
async function storeAttlog(
  deviceId: string,
  hasWebhook: boolean,
  timezone: string | null,
  body: string
): Promise<StoreResult> {
  const { records, errors } = parseAttlogBody(body);

  for (const err of errors) {
    deviceLogger.warn({ deviceId, ...err }, "failed to parse ATTLOG line");
  }

  if (records.length === 0) {
    return { stored: true };
  }

  const rows = records.map((record) => ({
    deviceId,
    devicePin: record.pin,
    punchTime: record.punchTime,
    // Only computable when the device has a configured timezone - never
    // guessed, never backfilled after the fact if one gets set later.
    punchTimeUtc: timezone ? zonedWallClockToUtc(record.punchTime, timezone) : null,
    status: record.status,
    verifyMode: record.verifyMode,
    workCode: record.workCode,
    reserved1: record.reserved1,
    reserved2: record.reserved2,
    rawLine: record.rawLine,
    // No webhook configured right now -> hold it back from automatic
    // delivery even if a webhook gets configured later. Only a fresh punch
    // ingested after that point, or an explicit admin retry, should ever
    // go out for this record.
    webhookHeld: !hasWebhook,
  }));

  try {
    const result = await prisma.punchRecord.createMany({ data: rows, skipDuplicates: true });
    deviceLogger.info(
      {
        deviceId,
        lineCount: records.length,
        inserted: result.count,
        duplicates: rows.length - result.count,
        parseErrors: errors.length,
      },
      "ATTLOG batch processed"
    );
    return { stored: true };
  } catch (err) {
    const kind = classifyDbError(err);
    if (kind !== "data") {
      deviceLogger.error(
        { err, deviceId, kind },
        "transient failure storing ATTLOG batch - withholding ack so the device retries the whole batch"
      );
      return { stored: false };
    }

    deviceLogger.warn(
      { err, deviceId },
      "ATTLOG batch had a data error - retrying records individually to isolate and skip only the offending line(s)"
    );
    let inserted = 0;
    let duplicates = 0;
    let skipped = 0;
    for (const row of rows) {
      try {
        await prisma.punchRecord.create({ data: row });
        inserted += 1;
      } catch (recErr) {
        if (recErr instanceof Prisma.PrismaClientKnownRequestError && recErr.code === "P2002") {
          duplicates += 1;
          continue;
        }
        const recKind = classifyDbError(recErr);
        if (recKind !== "data") {
          // The DB genuinely went away mid-fallback - nothing more we can
          // do this round. Withhold the ack; the device will retry the
          // whole batch, and whatever we already inserted above is
          // deduplicated away on that retry by the unique constraint.
          deviceLogger.error(
            { err: recErr, deviceId, kind: recKind },
            "lost DB mid per-record fallback - withholding ack for the remainder"
          );
          return { stored: false };
        }
        deviceLogger.error(
          { err: recErr, deviceId, rawLine: row.rawLine },
          "skipping unstorable ATTLOG record (data error) - this line will never be recorded"
        );
        skipped += 1;
      }
    }
    deviceLogger.info(
      { deviceId, lineCount: records.length, inserted, duplicates, skipped, parseErrors: errors.length },
      "ATTLOG batch processed (per-record fallback)"
    );
    return { stored: true };
  }
}

// POST /iclock/cdata?SN=...&table=ATTLOG|OPERLOG|... - punch/data push.
export async function handleCdataPost(req: Request, res: Response) {
  const sn = String(req.query.SN ?? "");
  const table = String(req.query.table ?? "").toUpperCase();
  const body = typeof req.body === "string" ? req.body : "";

  deviceLogger.info({ sn, table, bodyLength: body.length }, "cdata POST");

  const { device, trusted } = await resolveDevice(req, body);
  if (!device) {
    // Still-unregistered/pending SN, already captured inside resolveDevice.
    // This is data-bearing (a punch/OPERLOG/etc batch), unlike the
    // handshake - withhold the ack (503) so the device retries once an
    // admin claims it, instead of clearing its buffer and losing this
    // batch for good.
    sendUnclaimed(res);
    return;
  }

  if (!trusted) {
    sendRejected(res);
    return;
  }

  await touchDevice(device.id);

  let result: StoreResult;
  if (table === "ATTLOG") {
    const hasWebhook = Boolean(device.webhookEnabled && device.webhookUrl);
    result = await storeAttlog(device.id, hasWebhook, device.timezone, body);
  } else {
    // OPERLOG / USERINFO / FINGERTMP / FACE / photos / anything else -
    // captured verbatim so it's browsable per-device in the admin panel's
    // Raw Data Dump instead of only living in the process logs.
    deviceLogger.info({ deviceId: device.id, table, bodyLength: body.length }, "non-ATTLOG table push received");
    try {
      await logDeviceRawData(req, device.id, table || undefined, body);
      result = { stored: true };
    } catch (err) {
      const kind = classifyDbError(err);
      if (kind === "data") {
        // Retrying an identical unstorable payload would fail identically
        // forever - ack so the device doesn't wedge on it permanently, but
        // this is real device data that's now been dropped, so log loudly.
        deviceLogger.error(
          { err, deviceId: device.id, table },
          "unstorable raw data payload (data error) - acking OK, but this payload was NOT recorded"
        );
        result = { stored: true };
      } else {
        deviceLogger.error(
          { err, deviceId: device.id, table, kind },
          "transient failure storing raw data payload - withholding ack so the device retries"
        );
        result = { stored: false };
      }
    }
  }

  if (!result.stored) {
    sendPlainText(res, "Internal Server Error", 500);
    return;
  }

  sendPlainText(res, OK);
}
