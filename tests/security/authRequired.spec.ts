import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../helpers/securityTestApp";
import { config } from "../../src/config";

// Every /api/admin/* route except the handful that are deliberately public
// (login, signup, logout, version) must reject a request before it ever
// touches a handler's business logic, for four distinct ways of not being a
// legitimate session:
//   - no cookie at all
//   - a cookie that isn't a JWT (garbage string)
//   - a cookie signed with a different secret (forged/guessed/leaked-from-
//     elsewhere token - must fail on signature alone)
//   - a cookie that's a real, correctly-signed token but expired
// This is a structural property of requireAdminAuth being mounted ahead of
// every sub-router in src/admin/router.ts - this suite is the regression
// test that keeps it true as routes are added or refactored. Path params
// are placeholders: auth must be rejected before any :id/:serialNumber is
// ever looked up, so nothing here depends on a real fixture existing.

const PLACEHOLDER = "nonexistent-id-00000000000000000";

interface Endpoint {
  method: "get" | "post" | "patch" | "delete";
  path: string;
}

const PROTECTED_ENDPOINTS: Endpoint[] = [
  // auth.ts
  { method: "get", path: "/api/admin/auth/me" },
  { method: "patch", path: "/api/admin/auth/me/password" },
  // companies.ts
  { method: "get", path: "/api/admin/companies/options" },
  { method: "get", path: "/api/admin/companies" },
  { method: "get", path: `/api/admin/companies/${PLACEHOLDER}` },
  { method: "post", path: "/api/admin/companies" },
  { method: "patch", path: `/api/admin/companies/${PLACEHOLDER}` },
  { method: "delete", path: `/api/admin/companies/${PLACEHOLDER}` },
  // adminUsers.ts
  { method: "get", path: "/api/admin/admin-users" },
  { method: "post", path: "/api/admin/admin-users" },
  { method: "patch", path: `/api/admin/admin-users/${PLACEHOLDER}` },
  { method: "delete", path: `/api/admin/admin-users/${PLACEHOLDER}` },
  { method: "post", path: `/api/admin/admin-users/${PLACEHOLDER}/reset-password` },
  // devices.ts
  { method: "get", path: "/api/admin/devices/unregistered-pings" },
  { method: "delete", path: `/api/admin/devices/unregistered-pings/${PLACEHOLDER}` },
  { method: "post", path: "/api/admin/devices/unregistered-pings/delete-bulk" },
  { method: "get", path: "/api/admin/devices/options" },
  { method: "post", path: "/api/admin/devices/claim" },
  { method: "get", path: "/api/admin/devices" },
  { method: "get", path: `/api/admin/devices/${PLACEHOLDER}` },
  { method: "post", path: "/api/admin/devices" },
  { method: "patch", path: `/api/admin/devices/${PLACEHOLDER}` },
  { method: "post", path: `/api/admin/devices/${PLACEHOLDER}/test-webhook` },
  { method: "post", path: `/api/admin/devices/${PLACEHOLDER}/commands` },
  { method: "get", path: `/api/admin/devices/${PLACEHOLDER}/commands` },
  { method: "get", path: `/api/admin/devices/${PLACEHOLDER}/raw-logs` },
  { method: "delete", path: `/api/admin/devices/${PLACEHOLDER}/raw-logs/${PLACEHOLDER}` },
  { method: "post", path: `/api/admin/devices/${PLACEHOLDER}/raw-logs/delete-bulk` },
  { method: "delete", path: `/api/admin/devices/${PLACEHOLDER}` },
  // punchRecords.ts
  { method: "get", path: "/api/admin/punch-records" },
  { method: "get", path: "/api/admin/punch-records/failed" },
  { method: "get", path: `/api/admin/punch-records/${PLACEHOLDER}/deliveries` },
  { method: "post", path: `/api/admin/punch-records/${PLACEHOLDER}/retry` },
  { method: "post", path: "/api/admin/punch-records/retry-bulk" },
  { method: "delete", path: `/api/admin/punch-records/${PLACEHOLDER}` },
  { method: "post", path: "/api/admin/punch-records/delete-bulk" },
  // rawRequests.ts
  { method: "get", path: "/api/admin/raw-requests" },
  { method: "post", path: "/api/admin/raw-requests/delete-bulk" },
  { method: "delete", path: `/api/admin/raw-requests/${PLACEHOLDER}` },
  // webhookTemplates.ts
  { method: "get", path: "/api/admin/webhook-templates" },
];

function expiredToken(): string {
  return jwt.sign(
    { sub: "x", email: "x@example.test", role: "SUPER_ADMIN", companyId: null },
    config.jwtSecret,
    { expiresIn: -10 }
  );
}

function forgedToken(): string {
  return jwt.sign(
    { sub: "x", email: "x@example.test", role: "SUPER_ADMIN", companyId: null },
    "attacker-guessed-this-secret",
    { expiresIn: "1h" }
  );
}

describe("every protected admin API route requires authentication", () => {
  it.each(PROTECTED_ENDPOINTS)("$method $path -> 401 with no session cookie at all", async ({ method, path }) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
  });

  it.each(PROTECTED_ENDPOINTS)("$method $path -> 401 with a garbage (non-JWT) cookie", async ({ method, path }) => {
    const res = await request(app)
      [method](path)
      .set("Cookie", `${config.adminSessionCookieName}=not-a-real-token-at-all`)
      .send({});
    expect(res.status).toBe(401);
  });

  it.each(PROTECTED_ENDPOINTS)("$method $path -> 401 with a token forged with the wrong secret", async ({ method, path }) => {
    const res = await request(app)
      [method](path)
      .set("Cookie", `${config.adminSessionCookieName}=${forgedToken()}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it.each(PROTECTED_ENDPOINTS)("$method $path -> 401 with a validly-signed but expired token", async ({ method, path }) => {
    const res = await request(app)
      [method](path)
      .set("Cookie", `${config.adminSessionCookieName}=${expiredToken()}`)
      .send({});
    expect(res.status).toBe(401);
  });
});

describe("session integrity edge cases", () => {
  it("rejects a token whose alg is switched to none (classic JWT bypass attempt)", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "x", email: "x@example.test", role: "SUPER_ADMIN", companyId: null })
    ).toString("base64url");
    const noneToken = `${header}.${payload}.`;
    const res = await request(app)
      .get("/api/admin/companies")
      .set("Cookie", `${config.adminSessionCookieName}=${noneToken}`);
    expect(res.status).toBe(401);
  });

  it("rejects a COMPANY_ADMIN token with companyId null (corrupted/impossible session shape)", async () => {
    const token = jwt.sign(
      { sub: "x", email: "x@example.test", role: "COMPANY_ADMIN", companyId: null },
      config.jwtSecret,
      { expiresIn: "1h" }
    );
    const res = await request(app)
      .get("/api/admin/devices")
      .set("Cookie", `${config.adminSessionCookieName}=${token}`);
    expect(res.status).toBe(401);
  });

  it("does not authenticate via an Authorization header when no cookie is set (cookie is the only accepted transport)", async () => {
    const token = jwt.sign(
      { sub: "x", email: "x@example.test", role: "SUPER_ADMIN", companyId: null },
      config.jwtSecret,
      { expiresIn: "1h" }
    );
    const res = await request(app).get("/api/admin/companies").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
