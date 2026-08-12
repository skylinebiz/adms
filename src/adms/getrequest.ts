import { Request, Response } from "express";
import { prisma } from "../db/client";
import { deviceLogger } from "../logger";
import { findDeviceBySerial, logUnregisteredPing, touchDevice } from "./deviceLookup";

// GET /iclock/getrequest?SN=... - device polls for pending commands.
// v1: returns queued DeviceCommand rows (if any), formatted one per line as
// "C:<id>:<command>", and marks them SENT. Empty queue -> plain "OK".
export async function handleGetRequest(req: Request, res: Response) {
  const sn = String(req.query.SN ?? "");
  deviceLogger.info({ sn }, "getrequest poll");

  const device = await findDeviceBySerial(sn);
  if (!device) {
    await logUnregisteredPing(req, sn);
    res.status(200).type("text/plain; charset=UTF-8").send("OK");
    return;
  }

  await touchDevice(device.id);

  const pending = await prisma.deviceCommand.findMany({
    where: { deviceId: device.id, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  if (pending.length === 0) {
    res.status(200).type("text/plain; charset=UTF-8").send("OK");
    return;
  }

  await prisma.deviceCommand.updateMany({
    where: { id: { in: pending.map((c) => c.id) } },
    data: { status: "SENT", sentAt: new Date() },
  });

  const body = pending.map((c) => `C:${c.id}:${c.command}`).join("\n") + "\n";
  res.status(200).type("text/plain; charset=UTF-8").send(body);
}
