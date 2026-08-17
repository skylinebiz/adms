import { Request, Response } from "express";
import { prisma } from "../db/client";
import { deviceLogger } from "../logger";
import { resolveDevice, sendRejected, sendUnclaimed, touchDevice } from "./deviceLookup";

// POST /iclock/devicecmd?SN=... - device reports command execution result.
// Body is typically "ID=<commandId>&Return=<code>&CMD=<...>" as query-string-style text.
export async function handleDeviceCmd(req: Request, res: Response) {
  const sn = String(req.query.SN ?? "");
  const body = typeof req.body === "string" ? req.body : "";
  deviceLogger.info({ sn, body }, "devicecmd ack");

  const { device, trusted } = await resolveDevice(req, body);
  if (!device) {
    // Data-bearing (the device's own command-execution report), same as
    // cdata POST - withhold the ack (503) rather than silently discard it.
    // In practice an unclaimed device has no DeviceCommand rows to ack in
    // the first place (nothing has ever been queued for it), so this is
    // mostly defensive consistency with cdata POST's policy.
    sendUnclaimed(res);
    return;
  }
  if (!trusted) {
    sendRejected(res);
    return;
  }

  await touchDevice(device.id);

  // [^&\s]+, not \S+: the body is documented (and observed) as
  // &-joined fields ("ID=<id>&Return=<code>&CMD=<...>"), so \S+ would
  // greedily swallow every field after ID= too, unless ID happened to be
  // the last one - silently breaking ACK matching for any other body
  // shape. Caught live: a real ACK attempt captured
  // "ID=<realId>&Return=0&CMD=..." whole as the "id", which then matched
  // no row and got logged as "ack for unknown command id" even though
  // the real id was right there at the start.
  const idMatch = /ID=([^&\s]+)/.exec(body);
  if (idMatch) {
    await prisma.deviceCommand
      .update({
        where: { id: idMatch[1] },
        data: { status: "ACKED", ackedAt: new Date(), response: body },
      })
      .catch((err) => {
        deviceLogger.warn({ err, commandId: idMatch[1] }, "devicecmd ack for unknown command id");
      });
  }

  res.status(200).type("text/plain; charset=UTF-8").send("OK");
}
