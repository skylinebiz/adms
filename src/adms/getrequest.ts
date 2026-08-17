import { Request, Response } from "express";
import { prisma } from "../db/client";
import { deviceLogger } from "../logger";
import { resolveDevice, sendRejected, touchDevice } from "./deviceLookup";
import { computeTimeZoneOptionValue } from "./timezone";

// GET /iclock/getrequest?SN=... - device polls for pending commands.
// v1: returns queued DeviceCommand rows (if any), formatted one per line as
// "C:<id>:<command>", and marks them SENT. Empty queue -> plain "OK".
//
// Also carries TimeZone=<value> (see computeTimeZoneOptionValue in
// timezone.ts) when the device has one configured - on top of, not
// instead of, sending it in the GET /iclock/cdata handshake response.
// Some firmware (observed on an eSSL-branded SilkBio-101TC) essentially
// never repeats that handshake once running, living almost entirely in
// this getrequest poll loop instead - so a device whose clock only ever
// gets corrected on handshake might never actually see the fix. Sent on
// every poll, not just once, which is a feature here: if the device's
// clock drifts again for any reason, it self-corrects within one poll
// cycle, indefinitely, with no re-registration or manual action needed.
export async function handleGetRequest(req: Request, res: Response) {
  const sn = String(req.query.SN ?? "");
  deviceLogger.info({ sn }, "getrequest poll");

  const { device, trusted } = await resolveDevice(req);
  if (!device) {
    res.status(200).type("text/plain; charset=UTF-8").send("OK");
    return;
  }
  if (!trusted) {
    sendRejected(res);
    return;
  }

  await touchDevice(device.id);

  const pending = await prisma.deviceCommand.findMany({
    where: { deviceId: device.id, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  if (pending.length > 0) {
    await prisma.deviceCommand.updateMany({
      where: { id: { in: pending.map((c) => c.id) } },
      data: { status: "SENT", sentAt: new Date() },
    });
  }

  const lines = [
    ...(device.timezone ? [`TimeZone=${computeTimeZoneOptionValue(device.timezone)}`] : []),
    ...pending.map((c) => `C:${c.id}:${c.command}`),
  ];

  res.status(200).type("text/plain; charset=UTF-8").send(lines.length > 0 ? lines.join("\n") + "\n" : "OK");
}
