import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/db/client";
import { runRetentionSweep } from "../src/retentionSweep";
import {
  app,
  cleanupAll,
  createAdmin,
  createCompany,
  createDevice,
  RUN_TAG,
  TestAdmin,
  TestCompany,
} from "./helpers/securityTestApp";

let company: TestCompany;
let superAdmin: TestAdmin;
let originalSettings: { dataRetentionDays: number; webhookMaxAttempts: number; webhookTimeoutMs: number };

beforeAll(async () => {
  company = await createCompany();
  superAdmin = await createAdmin("SUPER_ADMIN", null);
  const settings = await prisma.platformSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  originalSettings = {
    dataRetentionDays: settings.dataRetentionDays,
    webhookMaxAttempts: settings.webhookMaxAttempts,
    webhookTimeoutMs: settings.webhookTimeoutMs,
  };
});

// PlatformSettings is a single global row shared by the whole DB (unlike
// every other fixture in this suite, which is scoped per-run) - any test
// that changes it must put it back, so it never leaks into an unrelated
// test or the real worker process polling the same dev database.
afterEach(async () => {
  await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: originalSettings,
  });
});

afterAll(async () => {
  await cleanupAll();
});

describe("GET/PATCH /settings", () => {
  it("GET returns the current dataRetentionDays as a super_admin", async () => {
    const res = await request(app).get("/api/admin/settings").set("Cookie", superAdmin.cookie);
    expect(res.status).toBe(200);
    expect(typeof res.body.settings.dataRetentionDays).toBe("number");
  });

  it("PATCH updates it and a subsequent GET reflects the change", async () => {
    const patchRes = await request(app)
      .patch("/api/admin/settings")
      .set("Cookie", superAdmin.cookie)
      .send({ dataRetentionDays: 45 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.settings.dataRetentionDays).toBe(45);

    const getRes = await request(app).get("/api/admin/settings").set("Cookie", superAdmin.cookie);
    expect(getRes.body.settings.dataRetentionDays).toBe(45);
  });

  it.each([0, -1, 1.5, 3651])("rejects an out-of-range dataRetentionDays: %p", async (value) => {
    const res = await request(app)
      .patch("/api/admin/settings")
      .set("Cookie", superAdmin.cookie)
      .send({ dataRetentionDays: value });
    expect(res.status).toBe(400);
  });

  it.each(["abc", null, {}, []])("rejects a wrong-typed dataRetentionDays: %p", async (value) => {
    const res = await request(app)
      .patch("/api/admin/settings")
      .set("Cookie", superAdmin.cookie)
      .send({ dataRetentionDays: value });
    expect(res.status).toBe(400);
  });

  it("rejects a completely empty body (every field is individually optional, but at least one must be present)", async () => {
    const res = await request(app).patch("/api/admin/settings").set("Cookie", superAdmin.cookie).send({});
    expect(res.status).toBe(400);
  });

  it("updates webhookMaxAttempts/webhookTimeoutMs independently of dataRetentionDays (a genuine partial update)", async () => {
    const before = await request(app).get("/api/admin/settings").set("Cookie", superAdmin.cookie);
    const patchRes = await request(app)
      .patch("/api/admin/settings")
      .set("Cookie", superAdmin.cookie)
      .send({ webhookMaxAttempts: 8, webhookTimeoutMs: 15000 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.settings.webhookMaxAttempts).toBe(8);
    expect(patchRes.body.settings.webhookTimeoutMs).toBe(15000);
    // dataRetentionDays untouched by a request that never mentioned it
    expect(patchRes.body.settings.dataRetentionDays).toBe(before.body.settings.dataRetentionDays);
  });

  it.each([0, -1, 1.5, 51])("rejects an out-of-range webhookMaxAttempts: %p", async (value) => {
    const res = await request(app)
      .patch("/api/admin/settings")
      .set("Cookie", superAdmin.cookie)
      .send({ webhookMaxAttempts: value });
    expect(res.status).toBe(400);
  });

  it.each([0, 999, 1.5, 120_001])("rejects an out-of-range webhookTimeoutMs: %p", async (value) => {
    const res = await request(app)
      .patch("/api/admin/settings")
      .set("Cookie", superAdmin.cookie)
      .send({ webhookTimeoutMs: value });
    expect(res.status).toBe(400);
  });
});

describe("runRetentionSweep", () => {
  it("deletes punch records (+ cascaded webhook delivery history), raw logs, device logs, unregistered pings, and device commands older than the window - and leaves newer rows alone", async () => {
    await prisma.platformSettings.update({ where: { id: "singleton" }, data: { dataRetentionDays: 30 } });

    const device = await createDevice(company.id);
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // past a 30-day window
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // within it

    const oldPunch = await prisma.punchRecord.create({
      data: {
        deviceId: device.id,
        devicePin: "1",
        punchTime: oldDate,
        status: 0,
        verifyMode: 1,
        rawLine: "raw",
        receivedAt: oldDate,
      },
    });
    await prisma.webhookDelivery.create({
      data: {
        punchRecordId: oldPunch.id,
        url: "https://example.com",
        attempt: 1,
        delivered: false,
        requestBody: "{}",
        requestHeaders: "{}",
      },
    });
    const recentPunch = await prisma.punchRecord.create({
      data: {
        deviceId: device.id,
        devicePin: "2",
        punchTime: recentDate,
        status: 0,
        verifyMode: 1,
        rawLine: "raw",
        receivedAt: recentDate,
      },
    });

    const oldRawRequestLog = await prisma.rawRequestLog.create({
      data: { endpoint: "/iclock/cdata", method: "GET", createdAt: oldDate, serialNumber: `${RUN_TAG}-SWEEP-OLD` },
    });
    const recentRawRequestLog = await prisma.rawRequestLog.create({
      data: { endpoint: "/iclock/cdata", method: "GET", createdAt: recentDate, serialNumber: `${RUN_TAG}-SWEEP-NEW` },
    });

    const oldDeviceRawLog = await prisma.deviceRawLog.create({
      data: { deviceId: device.id, endpoint: "/iclock/cdata", method: "POST", createdAt: oldDate },
    });
    const recentDeviceRawLog = await prisma.deviceRawLog.create({
      data: { deviceId: device.id, endpoint: "/iclock/cdata", method: "POST", createdAt: recentDate },
    });

    const oldPing = await prisma.unregisteredDevicePing.create({
      data: { serialNumber: `${RUN_TAG}-OLDPING`, endpoint: "/iclock/cdata", method: "GET", createdAt: oldDate },
    });
    const recentPing = await prisma.unregisteredDevicePing.create({
      data: { serialNumber: `${RUN_TAG}-NEWPING`, endpoint: "/iclock/cdata", method: "GET", createdAt: recentDate },
    });

    const oldCommand = await prisma.deviceCommand.create({
      data: { deviceId: device.id, command: "REBOOT", createdAt: oldDate },
    });
    const recentCommand = await prisma.deviceCommand.create({
      data: { deviceId: device.id, command: "REBOOT", createdAt: recentDate },
    });

    const result = await runRetentionSweep();
    expect(result.retentionDays).toBe(30);

    expect(await prisma.punchRecord.findUnique({ where: { id: oldPunch.id } })).toBeNull();
    expect(await prisma.webhookDelivery.findFirst({ where: { punchRecordId: oldPunch.id } })).toBeNull();
    expect(await prisma.punchRecord.findUnique({ where: { id: recentPunch.id } })).not.toBeNull();

    expect(await prisma.rawRequestLog.findUnique({ where: { id: oldRawRequestLog.id } })).toBeNull();
    expect(await prisma.rawRequestLog.findUnique({ where: { id: recentRawRequestLog.id } })).not.toBeNull();

    expect(await prisma.deviceRawLog.findUnique({ where: { id: oldDeviceRawLog.id } })).toBeNull();
    expect(await prisma.deviceRawLog.findUnique({ where: { id: recentDeviceRawLog.id } })).not.toBeNull();

    expect(await prisma.unregisteredDevicePing.findUnique({ where: { id: oldPing.id } })).toBeNull();
    expect(await prisma.unregisteredDevicePing.findUnique({ where: { id: recentPing.id } })).not.toBeNull();

    expect(await prisma.deviceCommand.findUnique({ where: { id: oldCommand.id } })).toBeNull();
    expect(await prisma.deviceCommand.findUnique({ where: { id: recentCommand.id } })).not.toBeNull();
  });

  it("never deletes Device, Company, AdminUser, or PendingDevice rows, no matter how old", async () => {
    await prisma.platformSettings.update({ where: { id: "singleton" }, data: { dataRetentionDays: 1 } });

    const veryOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const oldPendingDevice = await prisma.pendingDevice.create({
      data: { serialNumber: `${RUN_TAG}-PENDINGOLD`, firstSeenAt: veryOld, lastSeenAt: veryOld },
    });

    await runRetentionSweep();

    expect(await prisma.pendingDevice.findUnique({ where: { id: oldPendingDevice.id } })).not.toBeNull();
    expect(await prisma.company.findUnique({ where: { id: company.id } })).not.toBeNull();
    expect(await prisma.adminUser.findUnique({ where: { id: superAdmin.id } })).not.toBeNull();

    await prisma.pendingDevice.delete({ where: { id: oldPendingDevice.id } }).catch(() => null);
  });
});
