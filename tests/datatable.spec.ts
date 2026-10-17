import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/db/client";
import { buildOrderBy } from "../src/utils/datatable";
import { app, cleanupAll, createAdmin, createCompany, createDevice, RUN_TAG, TestAdmin, TestCompany } from "./helpers/securityTestApp";

// Server-side datatable behaviour (sort / search / pagination) across the
// admin list endpoints, against real Postgres.

describe("buildOrderBy", () => {
  const columns = { name: (dir: "asc" | "desc") => ({ name: dir }) };

  it("uses the fallback for an unknown or missing sortBy, never passing it through", () => {
    expect(buildOrderBy(undefined, undefined, columns, [{ name: "desc" }])).toEqual([{ name: "desc" }, { id: "desc" }]);
    expect(buildOrderBy("passwordHash", "asc", columns, [{ name: "desc" }])).toEqual([{ name: "desc" }, { id: "desc" }]);
    expect(buildOrderBy("__proto__", "asc", columns, [{ name: "desc" }])).toEqual([{ name: "desc" }, { id: "desc" }]);
  });

  it("maps a known column with a stable id tiebreaker", () => {
    expect(buildOrderBy("name", "asc", columns, [])).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(buildOrderBy("name", "desc", columns, [])).toEqual([{ name: "desc" }, { id: "desc" }]);
  });
});

let co: TestCompany;
let other: TestCompany;
let superAdmin: TestAdmin;
let companyAdmin: TestAdmin;
const serials: string[] = [];

beforeAll(async () => {
  co = await createCompany();
  other = await createCompany();
  superAdmin = await createAdmin("SUPER_ADMIN", null);
  companyAdmin = await createAdmin("COMPANY_ADMIN", co.id);
  // Five devices in `co` with distinct, predictable serials/labels, and one
  // in another company that a company_admin must never see through search.
  for (const letter of ["c", "a", "e", "b", "d"]) {
    const d = await createDevice(co.id, { serialNumber: `dt-${letter}-${RUN_TAG}` });
    await prisma.device.update({ where: { id: d.id }, data: { label: `label-${letter}` } });
    serials.push(d.serialNumber);
  }
  await createDevice(other.id, { serialNumber: `dt-hidden-${RUN_TAG}` });
});

afterAll(async () => {
  await cleanupAll();
  await prisma.$disconnect();
});

describe("GET /devices datatable params", () => {
  const list = (query: Record<string, string>, who = companyAdmin) =>
    request(app).get("/api/admin/devices").query(query).set("Cookie", who.cookie);

  it("sorts ascending and descending on a whitelisted column", async () => {
    const asc = await list({ sortBy: "serialNumber", sortDir: "asc", search: RUN_TAG });
    expect(asc.status).toBe(200);
    expect(asc.body.devices.map((d: { serialNumber: string }) => d.serialNumber)).toEqual([...serials].sort());

    const desc = await list({ sortBy: "label", sortDir: "desc", search: RUN_TAG });
    expect(desc.body.devices.map((d: { label: string }) => d.label)).toEqual([
      "label-e",
      "label-d",
      "label-c",
      "label-b",
      "label-a",
    ]);
  });

  it("paginates on the server and reports the filtered total", async () => {
    const page1 = await list({ sortBy: "serialNumber", sortDir: "asc", search: RUN_TAG, page: "1", pageSize: "2" });
    const page3 = await list({ sortBy: "serialNumber", sortDir: "asc", search: RUN_TAG, page: "3", pageSize: "2" });
    expect(page1.body.total).toBe(5);
    expect(page1.body.devices).toHaveLength(2);
    expect(page3.body.devices).toHaveLength(1);
    expect(page3.body.devices[0].serialNumber).toBe([...serials].sort()[4]);
  });

  it("searches case-insensitively across serial and label", async () => {
    const res = await list({ search: `LABEL-B` });
    expect(res.body.total).toBe(1);
    expect(res.body.devices[0].label).toBe("label-b");
  });

  it("ignores an unsortable / unknown sortBy instead of failing or leaking", async () => {
    const res = await list({ sortBy: "deviceSecret", sortDir: "asc", search: RUN_TAG });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
  });

  it("rejects an invalid sortDir", async () => {
    expect((await list({ sortDir: "sideways" })).status).toBe(400);
  });

  it("never lets search reach another company's rows", async () => {
    const res = await list({ search: "dt-hidden" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    const asSuper = await list({ search: "dt-hidden" }, superAdmin);
    expect(asSuper.body.total).toBe(1);
  });

  it("filters by computed status", async () => {
    await prisma.device.update({ where: { serialNumber: serials[0] }, data: { lastSeenAt: new Date() } });
    const online = await list({ status: "ONLINE", search: RUN_TAG });
    expect(online.body.devices.map((d: { serialNumber: string }) => d.serialNumber)).toEqual([serials[0]]);
    const unknown = await list({ status: "UNKNOWN", search: RUN_TAG });
    expect(unknown.body.total).toBe(4);
  });
});

describe("other list endpoints accept the same params", () => {
  it("admin users: role filter + sort + search", async () => {
    const res = await request(app)
      .get("/api/admin/admin-users")
      .query({ role: "SUPER_ADMIN", sortBy: "email", sortDir: "asc", search: RUN_TAG })
      .set("Cookie", superAdmin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.adminUsers.every((u: { role: string }) => u.role === "SUPER_ADMIN")).toBe(true);
  });

  it("companies: sort by device count desc puts the company with devices first", async () => {
    const res = await request(app)
      .get("/api/admin/companies")
      .query({ sortBy: "devices", sortDir: "desc", search: RUN_TAG })
      .set("Cookie", superAdmin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.companies[0].id).toBe(co.id);
    expect(res.body.companies[0]._count.devices).toBe(5);
  });

  it("unregistered pings, raw requests and raw logs respond to sort params", async () => {
    const pings = await request(app)
      .get("/api/admin/devices/unregistered-pings")
      .query({ sortBy: "pingCount", sortDir: "desc" })
      .set("Cookie", superAdmin.cookie);
    expect(pings.status).toBe(200);
    const raw = await request(app)
      .get("/api/admin/raw-requests")
      .query({ sortBy: "endpoint", sortDir: "asc", search: "iclock" })
      .set("Cookie", superAdmin.cookie);
    expect(raw.status).toBe(200);
    const device = await prisma.device.findUniqueOrThrow({ where: { serialNumber: serials[0] } });
    const logs = await request(app)
      .get(`/api/admin/devices/${device.id}/raw-logs`)
      .query({ sortBy: "table", sortDir: "asc", search: "OPER" })
      .set("Cookie", superAdmin.cookie);
    expect(logs.status).toBe(200);
  });

  it("punch records: sorts by PIN and searches by device", async () => {
    const device = await prisma.device.findUniqueOrThrow({ where: { serialNumber: serials[1] } });
    for (const pin of ["30", "10", "20"]) {
      await prisma.punchRecord.create({
        data: { deviceId: device.id, devicePin: pin, punchTime: new Date(), status: 0, verifyMode: 1, rawLine: pin },
      });
    }
    const res = await request(app)
      .get("/api/admin/punch-records")
      .query({ sortBy: "devicePin", sortDir: "asc", search: device.serialNumber })
      .set("Cookie", companyAdmin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.records.map((r: { devicePin: string }) => r.devicePin)).toEqual(["10", "20", "30"]);
    const failed = await request(app)
      .get("/api/admin/punch-records/failed")
      .query({ sortBy: "webhookAttempts", sortDir: "desc" })
      .set("Cookie", companyAdmin.cookie);
    expect(failed.status).toBe(200);
  });
});
