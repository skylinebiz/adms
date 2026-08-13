import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { deviceLogger } from "../logger";
import { resolveDevice, sendRejected, touchDevice } from "./deviceLookup";
import { parseAttlogBody } from "./parsers/attlog";
import { logDeviceRawData } from "./rawLog";
import { zonedWallClockToUtc } from "./timezone";

const OK = "OK";

function sendPlainText(res: Response, body: string, status = 200) {
  res.status(status).type("text/plain; charset=UTF-8").send(body);
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

async function storeAttlog(deviceId: string, hasWebhook: boolean, timezone: string | null, body: string) {
  const { records, errors } = parseAttlogBody(body);

  for (const err of errors) {
    deviceLogger.warn({ deviceId, ...err }, "failed to parse ATTLOG line");
  }

  let inserted = 0;
  let duplicates = 0;

  for (const record of records) {
    try {
      // Only computable when the device has a configured timezone - never
      // guessed, never backfilled after the fact if one gets set later.
      const punchTimeUtc = timezone ? zonedWallClockToUtc(record.punchTime, timezone) : null;
      await prisma.punchRecord.create({
        data: {
          deviceId,
          devicePin: record.pin,
          punchTime: record.punchTime,
          punchTimeUtc,
          status: record.status,
          verifyMode: record.verifyMode,
          workCode: record.workCode,
          reserved1: record.reserved1,
          reserved2: record.reserved2,
          rawLine: record.rawLine,
          // No webhook configured right now -> hold it back from automatic
          // delivery even if a webhook gets configured later. Only a fresh
          // punch ingested after that point, or an explicit admin retry,
          // should ever go out for this record.
          webhookHeld: !hasWebhook,
        },
      });
      inserted += 1;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Device retransmitted a punch it already sent - safe to ignore.
        duplicates += 1;
        continue;
      }
      deviceLogger.error({ err, deviceId, record }, "failed to persist punch record");
    }
  }

  deviceLogger.info(
    { deviceId, lineCount: records.length, inserted, duplicates, parseErrors: errors.length },
    "ATTLOG batch processed"
  );
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
    // Ack so the device doesn't hammer retries for an SN we can't map yet.
    sendPlainText(res, OK);
    return;
  }

  if (!trusted) {
    sendRejected(res);
    return;
  }

  await touchDevice(device.id);

  try {
    if (table === "ATTLOG") {
      const hasWebhook = Boolean(device.webhookEnabled && device.webhookUrl);
      await storeAttlog(device.id, hasWebhook, device.timezone, body);
    } else {
      // OPERLOG / USERINFO / FINGERTMP / FACE / photos / anything else -
      // captured verbatim so it's browsable per-device in the admin panel's
      // Raw Data Dump instead of only living in the process logs.
      deviceLogger.info({ deviceId: device.id, table, bodyLength: body.length }, "non-ATTLOG table push received");
      await logDeviceRawData(req, device.id, table || undefined, body);
    }
  } catch (err) {
    // Never let a bad payload 500 the whole batch - the device just retries forever.
    deviceLogger.error({ err, sn, table }, "unexpected error handling cdata POST");
  }

  sendPlainText(res, OK);
}
