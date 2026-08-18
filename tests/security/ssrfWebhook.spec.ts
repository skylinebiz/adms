import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app, cleanupAll, createAdmin, createCompany, createDevice, TestAdmin, TestCompany } from "../helpers/securityTestApp";

// webhookUrl is set by the lowest-privilege authenticated role this API has
// (any COMPANY_ADMIN, including a brand new self-signup with no vetting),
// and the server itself makes an outbound HTTP request to it - both
// synchronously via test-webhook (which echoes the response straight back
// to the caller) and later for real, automatically, on every punch. With no
// restriction on the target host that's a server-side request forgery
// primitive: point it at 127.0.0.1, an internal hostname, or the cloud
// metadata address and read back what's there. This suite exercises the
// guard added in src/utils/ssrfGuard.ts across every place a webhook URL is
// accepted.

let company: TestCompany;
let admin: TestAdmin;

beforeAll(async () => {
  company = await createCompany();
  admin = await createAdmin("COMPANY_ADMIN", company.id);
});

afterAll(async () => {
  await cleanupAll();
});

const PRIVATE_TARGETS = [
  "http://127.0.0.1/",
  "http://127.0.0.1:5432/",
  "http://localhost/",
  "http://localhost:8080/admin/devices",
  "http://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
  "http://10.0.0.5/",
  "http://192.168.1.1/",
  "http://172.16.0.1/",
  "http://[::1]/",
  "http://0.0.0.0/",
];

describe("webhookUrl on device create is rejected for private/internal/loopback targets", () => {
  it.each(PRIVATE_TARGETS)("rejects %s", async (url) => {
    const res = await request(app)
      .post("/api/admin/devices")
      .set("Cookie", admin.cookie)
      .send({
        companyId: company.id,
        serialNumber: `SSRF-CREATE-${Date.now()}-${Math.random()}`,
        deviceSecret: "s",
        timezone: "UTC",
        webhookUrl: url,
      });
    expect(res.status).toBe(400);
  });

  it("still accepts a normal-looking public URL (guard isn't just rejecting everything)", async () => {
    const res = await request(app)
      .post("/api/admin/devices")
      .set("Cookie", admin.cookie)
      .send({
        companyId: company.id,
        serialNumber: `SSRF-OK-${Date.now()}`,
        deviceSecret: "s",
        timezone: "UTC",
        webhookUrl: "https://example.com/webhook",
      });
    expect(res.status).toBe(201);
  });

  it("rejects a non-http(s) scheme (file:// etc.)", async () => {
    const res = await request(app)
      .post("/api/admin/devices")
      .set("Cookie", admin.cookie)
      .send({
        companyId: company.id,
        serialNumber: `SSRF-SCHEME-${Date.now()}`,
        deviceSecret: "s",
        timezone: "UTC",
        webhookUrl: "file:///etc/passwd",
      });
    // Either zod's own .url() check or the SSRF guard rejects this - either
    // way it must be a 400, never accepted.
    expect(res.status).toBe(400);
  });
});

describe("webhookUrl on device update (PATCH) is rejected for private targets", () => {
  it("rejects reconfiguring an existing device's webhook to an internal address", async () => {
    const device = await createDevice(company.id);
    const res = await request(app)
      .patch(`/api/admin/devices/${device.id}`)
      .set("Cookie", admin.cookie)
      .send({ webhookUrl: "http://169.254.169.254/latest/meta-data/iam/security-credentials/" });
    expect(res.status).toBe(400);
  });

  it("clearing webhookUrl to null is still allowed (guard only fires on a truthy new URL)", async () => {
    const device = await createDevice(company.id);
    const res = await request(app)
      .patch(`/api/admin/devices/${device.id}`)
      .set("Cookie", admin.cookie)
      .send({ webhookUrl: null });
    expect(res.status).toBe(200);
  });
});

describe("POST /devices/:id/test-webhook is rejected for private targets, both saved and overridden", () => {
  it("rejects when the override url param targets an internal address", async () => {
    const device = await createDevice(company.id);
    const res = await request(app)
      .post(`/api/admin/devices/${device.id}/test-webhook`)
      .set("Cookie", admin.cookie)
      .send({ url: "http://127.0.0.1:5432/" });
    expect(res.status).toBe(400);
  });
});
