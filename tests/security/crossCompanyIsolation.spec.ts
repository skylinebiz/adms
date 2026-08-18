import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../src/db/client";
import {
  app,
  cleanupAll,
  createAdmin,
  createCompany,
  createDevice,
  TestAdmin,
  TestCompany,
} from "../helpers/securityTestApp";

// The core multitenancy promise of this app: a COMPANY_ADMIN for Company A
// must never be able to read or modify Company B's data, no matter what ID
// they put in the URL or body - this is the classic IDOR (Insecure Direct
// Object Reference) class of bug. Every check below has company A's admin
// deliberately reaching across to company B's real, existing resources.

let companyA: TestCompany;
let companyB: TestCompany;
let adminA: TestAdmin;
let adminB: TestAdmin;
let superAdmin: TestAdmin;
let deviceB: Awaited<ReturnType<typeof createDevice>>;
let punchB: { id: string };

beforeAll(async () => {
  companyA = await createCompany();
  companyB = await createCompany();
  adminA = await createAdmin("COMPANY_ADMIN", companyA.id);
  adminB = await createAdmin("COMPANY_ADMIN", companyB.id);
  superAdmin = await createAdmin("SUPER_ADMIN", null);
  deviceB = await createDevice(companyB.id);
  punchB = await prisma.punchRecord.create({
    data: {
      deviceId: deviceB.id,
      devicePin: "1",
      punchTime: new Date(),
      status: 0,
      verifyMode: 1,
      rawLine: "raw",
    },
  });
});

afterAll(async () => {
  await cleanupAll();
});

describe("company_admin cannot read another company's resources by ID", () => {
  it("GET /companies/:id on a foreign company", async () => {
    const res = await request(app).get(`/api/admin/companies/${companyB.id}`).set("Cookie", adminA.cookie);
    expect(res.status).toBe(403);
  });

  it("GET /devices/:id on a foreign device", async () => {
    const res = await request(app).get(`/api/admin/devices/${deviceB.id}`).set("Cookie", adminA.cookie);
    expect(res.status).toBe(403);
  });

  it("GET /devices/:id/commands on a foreign device", async () => {
    const res = await request(app).get(`/api/admin/devices/${deviceB.id}/commands`).set("Cookie", adminA.cookie);
    expect(res.status).toBe(403);
  });

  it("GET /devices/:id/raw-logs on a foreign device", async () => {
    const res = await request(app).get(`/api/admin/devices/${deviceB.id}/raw-logs`).set("Cookie", adminA.cookie);
    expect(res.status).toBe(403);
  });

  it("GET /punch-records/:id/deliveries on a foreign punch record", async () => {
    const res = await request(app)
      .get(`/api/admin/punch-records/${punchB.id}/deliveries`)
      .set("Cookie", adminA.cookie);
    expect(res.status).toBe(403);
  });

  it("list endpoints never return the other company's rows, even unfiltered", async () => {
    const devices = await request(app).get("/api/admin/devices").set("Cookie", adminA.cookie);
    expect(devices.body.devices.some((d: { id: string }) => d.id === deviceB.id)).toBe(false);

    const companies = await request(app).get("/api/admin/companies").set("Cookie", adminA.cookie);
    expect(companies.body.companies.some((c: { id: string }) => c.id === companyB.id)).toBe(false);

    const admins = await request(app).get("/api/admin/admin-users").set("Cookie", adminA.cookie);
    expect(admins.body.adminUsers.some((u: { id: string }) => u.id === adminB.id)).toBe(false);
  });

  it("list endpoints ignore an explicit ?companyId= for the OTHER company (scope can't be overridden by query param)", async () => {
    const res = await request(app)
      .get(`/api/admin/devices?companyId=${companyB.id}`)
      .set("Cookie", adminA.cookie);
    expect(res.status).toBe(200);
    expect(res.body.devices.every((d: { companyId: string }) => d.companyId === companyA.id)).toBe(true);
    expect(res.body.devices.some((d: { id: string }) => d.id === deviceB.id)).toBe(false);
  });
});

describe("company_admin cannot write to another company's resources", () => {
  it("PATCH /devices/:id on a foreign device", async () => {
    const res = await request(app)
      .patch(`/api/admin/devices/${deviceB.id}`)
      .set("Cookie", adminA.cookie)
      .send({ label: "pwned" });
    expect(res.status).toBe(403);
    const stillOriginal = await prisma.device.findUnique({ where: { id: deviceB.id } });
    expect(stillOriginal?.label).not.toBe("pwned");
  });

  it("DELETE /devices/:id on a foreign device", async () => {
    const res = await request(app).delete(`/api/admin/devices/${deviceB.id}`).set("Cookie", adminA.cookie);
    expect(res.status).toBe(403);
    const stillThere = await prisma.device.findUnique({ where: { id: deviceB.id } });
    expect(stillThere).not.toBeNull();
  });

  it("POST /devices/:id/commands on a foreign device", async () => {
    const res = await request(app)
      .post(`/api/admin/devices/${deviceB.id}/commands`)
      .set("Cookie", adminA.cookie)
      .send({ command: "REBOOT" });
    expect(res.status).toBe(403);
  });

  it("POST /devices/:id/test-webhook on a foreign device", async () => {
    const res = await request(app)
      .post(`/api/admin/devices/${deviceB.id}/test-webhook`)
      .set("Cookie", adminA.cookie)
      .send({});
    expect(res.status).toBe(403);
  });

  it("POST /devices (create) with a foreign companyId in the body is rejected, not silently reassigned", async () => {
    const res = await request(app)
      .post("/api/admin/devices")
      .set("Cookie", adminA.cookie)
      .send({
        companyId: companyB.id,
        serialNumber: `IDOR-${Date.now()}`,
        deviceSecret: "whatever",
        timezone: "UTC",
      });
    expect(res.status).toBe(403);
    const created = await prisma.device.findFirst({ where: { serialNumber: { startsWith: "IDOR-" } } });
    expect(created).toBeNull();
  });

  it("POST /devices/claim into a foreign companyId is rejected", async () => {
    const res = await request(app)
      .post("/api/admin/devices/claim")
      .set("Cookie", adminA.cookie)
      .send({ serialNumber: "SOME-UNCLAIMED-SN", companyId: companyB.id, timezone: "UTC" });
    expect(res.status).toBe(403);
  });

  it("POST /punch-records/:id/retry on a foreign punch record", async () => {
    const res = await request(app).post(`/api/admin/punch-records/${punchB.id}/retry`).set("Cookie", adminA.cookie);
    expect(res.status).toBe(403);
  });

  it("POST /punch-records/retry-bulk silently drops foreign IDs instead of acting on them", async () => {
    const before = await prisma.punchRecord.findUnique({ where: { id: punchB.id } });
    const res = await request(app)
      .post("/api/admin/punch-records/retry-bulk")
      .set("Cookie", adminA.cookie)
      .send({ ids: [punchB.id] });
    expect(res.status).toBe(200);
    expect(res.body.retried).toBe(0);
    const after = await prisma.punchRecord.findUnique({ where: { id: punchB.id } });
    expect(after?.nextAttemptAt).toEqual(before?.nextAttemptAt);
  });

  it("PATCH /admin-users/:id cannot move a foreign admin between companies (super_admin-gated anyway, but confirm 403 not 404/500)", async () => {
    const res = await request(app)
      .patch(`/api/admin/admin-users/${adminB.id}`)
      .set("Cookie", adminA.cookie)
      .send({ companyId: companyA.id });
    expect(res.status).toBe(403);
  });
});

describe("a pending device already attributed to one company cannot be claimed by another", () => {
  it("blocks the claim and does not create a Device row", async () => {
    const sn = `PENDING-CROSS-${Date.now()}`;
    await prisma.pendingDevice.create({ data: { serialNumber: sn, companyId: companyB.id, secret: "s" } });
    const res = await request(app)
      .post("/api/admin/devices/claim")
      .set("Cookie", adminA.cookie)
      .send({ serialNumber: sn, companyId: companyA.id, timezone: "UTC" });
    expect(res.status).toBe(403);
    const device = await prisma.device.findUnique({ where: { serialNumber: sn } });
    expect(device).toBeNull();
    await prisma.pendingDevice.delete({ where: { serialNumber: sn } }).catch(() => null);
  });
});

describe("super_admin is exempt from all of the above by design", () => {
  it("can read a device belonging to any company", async () => {
    const res = await request(app).get(`/api/admin/devices/${deviceB.id}`).set("Cookie", superAdmin.cookie);
    expect(res.status).toBe(200);
  });
});
