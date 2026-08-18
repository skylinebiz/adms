import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app, cleanupAll, createAdmin, createCompany, createDevice, TestAdmin, TestCompany } from "../helpers/securityTestApp";

// A COMPANY_ADMIN is a real, successfully-authenticated user - not an
// attacker in the "no valid session" sense authRequired.spec.ts covers.
// This suite checks the next layer: does the API also verify that THIS
// authenticated user is allowed to perform THIS action, for every route
// that's supposed to be super_admin-only. A route that only checks "is
// there a valid session" and forgets "does this role get to do this" is
// exactly the class of bug this suite exists to catch.

let companyA: TestCompany;
let companyAdmin: TestAdmin;
let superAdmin: TestAdmin;

beforeAll(async () => {
  companyA = await createCompany();
  companyAdmin = await createAdmin("COMPANY_ADMIN", companyA.id);
  superAdmin = await createAdmin("SUPER_ADMIN", null);
});

afterAll(async () => {
  await cleanupAll();
});

interface SuperAdminOnlyCase {
  name: string;
  run: () => Promise<request.Response>;
}

describe("super_admin-only actions reject a COMPANY_ADMIN session with 403", () => {
  it("POST /companies (create company)", async () => {
    const res = await request(app)
      .post("/api/admin/companies")
      .set("Cookie", companyAdmin.cookie)
      .send({ name: "Attacker Co", slug: `attacker-${Date.now()}` });
    expect(res.status).toBe(403);
  });

  it("PATCH /companies/:id (rename ANY company, including one's own)", async () => {
    const res = await request(app)
      .patch(`/api/admin/companies/${companyA.id}`)
      .set("Cookie", companyAdmin.cookie)
      .send({ name: "Renamed by non-admin" });
    expect(res.status).toBe(403);
  });

  it("DELETE /companies/:id", async () => {
    const res = await request(app).delete(`/api/admin/companies/${companyA.id}`).set("Cookie", companyAdmin.cookie);
    expect(res.status).toBe(403);
  });

  it("PATCH /admin-users/:id (role/company escalation surface)", async () => {
    const res = await request(app)
      .patch(`/api/admin/admin-users/${companyAdmin.id}`)
      .set("Cookie", companyAdmin.cookie)
      .send({ role: "SUPER_ADMIN" });
    expect(res.status).toBe(403);
  });

  it("DELETE /admin-users/:id", async () => {
    const res = await request(app).delete(`/api/admin/admin-users/${superAdmin.id}`).set("Cookie", companyAdmin.cookie);
    expect(res.status).toBe(403);
  });

  it("POST /admin-users/:id/reset-password (reset ANOTHER admin's password)", async () => {
    const res = await request(app)
      .post(`/api/admin/admin-users/${superAdmin.id}/reset-password`)
      .set("Cookie", companyAdmin.cookie)
      .send({ newPassword: "hijacked-password-123" });
    expect(res.status).toBe(403);
  });

  it("GET /raw-requests (platform-wide firehose, unscoped to any company)", async () => {
    const res = await request(app).get("/api/admin/raw-requests").set("Cookie", companyAdmin.cookie);
    expect(res.status).toBe(403);
  });

  it("POST /raw-requests/delete-bulk", async () => {
    const res = await request(app)
      .post("/api/admin/raw-requests/delete-bulk")
      .set("Cookie", companyAdmin.cookie)
      .send({ ids: ["x"] });
    expect(res.status).toBe(403);
  });

  it("DELETE /raw-requests/:id", async () => {
    const res = await request(app).delete("/api/admin/raw-requests/some-id").set("Cookie", companyAdmin.cookie);
    expect(res.status).toBe(403);
  });

  it("DELETE /punch-records/:id (destructive to audit history)", async () => {
    const res = await request(app).delete("/api/admin/punch-records/some-id").set("Cookie", companyAdmin.cookie);
    expect(res.status).toBe(403);
  });

  it("POST /punch-records/delete-bulk", async () => {
    const res = await request(app)
      .post("/api/admin/punch-records/delete-bulk")
      .set("Cookie", companyAdmin.cookie)
      .send({ ids: ["x"] });
    expect(res.status).toBe(403);
  });

  it("DELETE /devices/unregistered-pings/:sn", async () => {
    const res = await request(app)
      .delete("/api/admin/devices/unregistered-pings/SOME-SN")
      .set("Cookie", companyAdmin.cookie);
    expect(res.status).toBe(403);
  });

  it("POST /devices/unregistered-pings/delete-bulk", async () => {
    const res = await request(app)
      .post("/api/admin/devices/unregistered-pings/delete-bulk")
      .set("Cookie", companyAdmin.cookie)
      .send({ serialNumbers: ["x"] });
    expect(res.status).toBe(403);
  });

  it("DELETE /devices/:id/raw-logs/:logId and delete-bulk, on the caller's OWN device", async () => {
    const device = await createDevice(companyA.id);
    const del = await request(app)
      .delete(`/api/admin/devices/${device.id}/raw-logs/some-log-id`)
      .set("Cookie", companyAdmin.cookie);
    expect(del.status).toBe(403);
    const bulk = await request(app)
      .post(`/api/admin/devices/${device.id}/raw-logs/delete-bulk`)
      .set("Cookie", companyAdmin.cookie)
      .send({ ids: ["x"] });
    expect(bulk.status).toBe(403);
  });
});

describe("the same actions succeed (pass the role gate) for a real SUPER_ADMIN session", () => {
  it("PATCH /companies/:id", async () => {
    const res = await request(app)
      .patch(`/api/admin/companies/${companyA.id}`)
      .set("Cookie", superAdmin.cookie)
      .send({ name: "Renamed by super admin" });
    expect(res.status).toBe(200);
  });

  it("GET /raw-requests", async () => {
    const res = await request(app).get("/api/admin/raw-requests").set("Cookie", superAdmin.cookie);
    expect(res.status).toBe(200);
  });
});
