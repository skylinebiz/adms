import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { prisma } from "../../src/db/client";
import { app, cleanupAll, createAdmin, createCompany, RUN_TAG, TestAdmin, TestCompany } from "../helpers/securityTestApp";

// Treats every JSON-accepting endpoint as hostile input: wrong types, missing
// required fields, unknown/extra fields (mass-assignment attempts - can a
// caller set a field the schema never exposed, like id/role/companyId on a
// resource they don't own?), SQL-injection-shaped strings (must be treated
// as inert data, not executed - Prisma parameterizes everything so this is
// mostly a "did NOT bypass auth / did NOT 500" check), prototype-pollution
// key names, non-object top-level bodies, and oversized payloads.

let companyA: TestCompany;
let adminA: TestAdmin;
let superAdmin: TestAdmin;
const REAL_LOGIN_PASSWORD = "a-real-password-123";
let realLoginEmail: string;

beforeAll(async () => {
  companyA = await createCompany();
  adminA = await createAdmin("COMPANY_ADMIN", companyA.id);
  superAdmin = await createAdmin("SUPER_ADMIN", null);
  // The shared createAdmin() helper stamps a placeholder passwordHash (it
  // mints session cookies directly, bypassing bcrypt for speed) - the actual
  // /login flow needs a real bcrypt hash to compare against.
  realLoginEmail = `real-login-${RUN_TAG}@example.test`;
  await prisma.adminUser.create({
    data: {
      email: realLoginEmail,
      passwordHash: await bcrypt.hash(REAL_LOGIN_PASSWORD, 12),
      role: "COMPANY_ADMIN",
      companyId: companyA.id,
    },
  });
});

afterAll(async () => {
  await cleanupAll();
});

describe("login endpoint under hostile input", () => {
  it("rejects a classic SQL-injection-shaped email/password without a 500 or a bypass", async () => {
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: "' OR '1'='1' --", password: "' OR '1'='1' --" });
    expect(res.status).toBe(400); // fails email() format validation before ever touching the DB
  });

  it("returns the identical error for 'no such account' and 'wrong password' - never reveals which one it was", async () => {
    const noSuchAccount = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: `nobody-${Date.now()}@example.test`, password: "whatever12" });
    const wrongPassword = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: realLoginEmail, password: "definitely-the-wrong-password" });
    expect(noSuchAccount.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(noSuchAccount.body.error).toBe(wrongPassword.body.error);
  });

  it("rejects wrong-typed fields (numbers/objects/arrays instead of strings)", async () => {
    const cases = [
      { email: 12345, password: "whatever12" },
      { email: { $ne: null }, password: "whatever12" },
      { email: ["a@example.test"], password: "whatever12" },
      { email: "a@example.test", password: 12345 },
      { email: "a@example.test", password: null },
    ];
    for (const body of cases) {
      const res = await request(app).post("/api/admin/auth/login").send(body);
      expect(res.status).toBe(400);
    }
  });

  it("rejects a missing body / empty object / non-object top-level body", async () => {
    const empty = await request(app).post("/api/admin/auth/login").send({});
    expect(empty.status).toBe(400);

    const arr = await request(app).post("/api/admin/auth/login").send(["a@example.test", "whatever12"]);
    expect(arr.status).toBe(400);

    const str = await request(app)
      .post("/api/admin/auth/login")
      .type("json")
      .send('"just a string"');
    expect(str.status).toBe(400);
  });

  it("rejects malformed JSON body outright (bad Content-Type parse) without a 500", async () => {
    const res = await request(app)
      .post("/api/admin/auth/login")
      .set("Content-Type", "application/json")
      .send("{not valid json");
    expect(res.status).toBe(400);
  });

  it("rejects a body over the 1mb JSON limit without a 500", async () => {
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: "a@example.test", password: "x".repeat(2 * 1024 * 1024) });
    expect([400, 413]).toContain(res.status);
  });
});

describe("signup cannot be used for privilege escalation via extra fields", () => {
  it("ignores an attacker-supplied role/companyId/id and always creates a COMPANY_ADMIN of a brand new company", async () => {
    const slug = `sig-${Date.now()}`;
    const res = await request(app)
      .post("/api/admin/auth/signup")
      .send({
        companyName: "Sig Test Co",
        slug,
        email: `sig-${Date.now()}@example.test`,
        password: "longenough1",
        role: "SUPER_ADMIN",
        companyId: companyA.id,
        id: "attacker-chosen-id",
        mustChangePassword: false,
      });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("COMPANY_ADMIN");
    expect(res.body.user.companyId).not.toBe(companyA.id);
    expect(res.body.user.id).not.toBe("attacker-chosen-id");
    // cleanup this one-off company directly (outside the RUN_TAG-based helper slug shape)
    await prisma.company.delete({ where: { slug } }).catch(() => null);
  });
});

describe("admin-user creation cannot be used for privilege escalation", () => {
  it("company_admin cannot create a SUPER_ADMIN by sending role: SUPER_ADMIN", async () => {
    const res = await request(app)
      .post("/api/admin/admin-users")
      .set("Cookie", adminA.cookie)
      .send({ email: `esc-${Date.now()}@example.test`, password: "longenough1", role: "SUPER_ADMIN", companyId: companyA.id });
    expect(res.status).toBe(403);
  });

  it("company_admin cannot create an admin under a different companyId than their own", async () => {
    const otherCompany = await createCompany();
    const res = await request(app)
      .post("/api/admin/admin-users")
      .set("Cookie", adminA.cookie)
      .send({ email: `esc2-${Date.now()}@example.test`, password: "longenough1", role: "COMPANY_ADMIN", companyId: otherCompany.id });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid role enum value instead of coercing it", async () => {
    const res = await request(app)
      .post("/api/admin/admin-users")
      .set("Cookie", superAdmin.cookie)
      .send({ email: `bad-role-${Date.now()}@example.test`, password: "longenough1", role: "ROOT", companyId: companyA.id });
    expect(res.status).toBe(400);
  });

  it("rejects role COMPANY_ADMIN with no companyId rather than creating an orphaned admin", async () => {
    const res = await request(app)
      .post("/api/admin/admin-users")
      .set("Cookie", superAdmin.cookie)
      .send({ email: `orphan-${Date.now()}@example.test`, password: "longenough1", role: "COMPANY_ADMIN" });
    expect(res.status).toBe(400);
  });
});

describe("device creation/update reject malformed and mass-assignment payloads", () => {
  it("rejects wrong-typed companyId/serialNumber (numbers/objects instead of strings)", async () => {
    const res = await request(app)
      .post("/api/admin/devices")
      .set("Cookie", superAdmin.cookie)
      .send({ companyId: 12345, serialNumber: { toString: () => "x" }, deviceSecret: "s", timezone: "UTC" });
    expect(res.status).toBe(400);
  });

  it("ignores an attacker-supplied id/createdAt/webhookSecret on create - only schema fields are ever applied", async () => {
    const sn = `MASS-${Date.now()}`;
    const res = await request(app)
      .post("/api/admin/devices")
      .set("Cookie", superAdmin.cookie)
      .send({
        companyId: companyA.id,
        serialNumber: sn,
        deviceSecret: "s",
        timezone: "UTC",
        id: "attacker-chosen-device-id",
        webhookSecret: "attacker-chosen-webhook-secret",
        createdAt: "1999-01-01T00:00:00.000Z",
      });
    expect(res.status).toBe(201);
    expect(res.body.device.id).not.toBe("attacker-chosen-device-id");
    // webhookSecret is stripped from the response, but the point is it was
    // never set from client input at all (create only auto-generates one
    // when a webhookUrl was also provided) - verify directly in the DB.
    const row = await prisma.device.findUnique({ where: { serialNumber: sn } });
    expect(row?.webhookSecret).toBeNull();
    expect(new Date(row!.createdAt).getFullYear()).not.toBe(1999);
  });

  it("rejects an invalid IANA timezone string instead of silently accepting it", async () => {
    const res = await request(app)
      .post("/api/admin/devices")
      .set("Cookie", superAdmin.cookie)
      .send({ companyId: companyA.id, serialNumber: `TZ-${Date.now()}`, deviceSecret: "s", timezone: "Not/AZone" });
    expect(res.status).toBe(400);
  });

  it("PATCH cannot reassign a device to a different company (companyId isn't in the update schema at all)", async () => {
    const otherCompany = await createCompany();
    const device = await prisma.device.create({
      data: { companyId: companyA.id, serialNumber: `NOREASSIGN-${Date.now()}`, deviceSecret: "s", timezone: "UTC" },
    });
    const res = await request(app)
      .patch(`/api/admin/devices/${device.id}`)
      .set("Cookie", superAdmin.cookie)
      .send({ companyId: otherCompany.id, label: "still mine" });
    expect(res.status).toBe(200);
    const row = await prisma.device.findUnique({ where: { id: device.id } });
    expect(row?.companyId).toBe(companyA.id); // unchanged - extra field silently ignored, not applied
  });
});

describe("prototype-pollution-shaped keys are inert", () => {
  it("a __proto__ key in a JSON body does not pollute Object.prototype and the request is handled normally", async () => {
    const slug = `proto-${Date.now()}`;
    const res = await request(app)
      .post("/api/admin/companies")
      .set("Cookie", superAdmin.cookie)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ name: "Proto Co", slug, __proto__: { polluted: "yes" }, constructor: { prototype: { polluted: "yes" } } }));
    expect(res.status).toBe(201);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    await prisma.company.delete({ where: { slug } }).catch(() => null);
  });
});

describe("pagination query params reject non-numeric / out-of-range values instead of crashing", () => {
  it.each([
    { page: "'; DROP TABLE companies; --" },
    { page: "-1" },
    { page: "0" },
    { pageSize: "0" },
    { pageSize: "999999" },
    { pageSize: "-50" },
    { page: "1.5" },
    { page: "NaN" },
  ])("query %o -> 400, not 500", async (query) => {
    const res = await request(app).get("/api/admin/devices").query(query).set("Cookie", superAdmin.cookie);
    expect(res.status).toBe(400);
  });
});

describe("bulk-action endpoints reject malformed id arrays", () => {
  it("rejects a non-array ids field", async () => {
    const res = await request(app)
      .post("/api/admin/punch-records/retry-bulk")
      .set("Cookie", superAdmin.cookie)
      .send({ ids: "not-an-array" });
    expect(res.status).toBe(400);
  });

  it("rejects an empty ids array", async () => {
    const res = await request(app)
      .post("/api/admin/punch-records/retry-bulk")
      .set("Cookie", superAdmin.cookie)
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized ids array (over the 500 cap)", async () => {
    const res = await request(app)
      .post("/api/admin/punch-records/retry-bulk")
      .set("Cookie", superAdmin.cookie)
      .send({ ids: Array.from({ length: 501 }, (_, i) => `id-${i}`) });
    expect(res.status).toBe(400);
  });

  it("rejects an array containing non-string entries", async () => {
    const res = await request(app)
      .post("/api/admin/punch-records/retry-bulk")
      .set("Cookie", superAdmin.cookie)
      .send({ ids: [1, 2, 3] });
    expect(res.status).toBe(400);
  });
});
