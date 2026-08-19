import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/db/client";
import { app, cleanupAll, createAdmin, createCompany, createDevice, TestAdmin, TestCompany } from "./helpers/securityTestApp";

// E2E coverage for the retry-eligibility fix: a device with no active
// webhook (removed, disabled, or never configured) must reject a retry
// attempt via the API - not just hide the button client-side - because
// queuing it would set nextAttemptAt to a value the worker's claim query
// (which requires an active webhook) will never actually pick up.

let company: TestCompany;
let admin: TestAdmin;

beforeAll(async () => {
  company = await createCompany();
  admin = await createAdmin("COMPANY_ADMIN", company.id);
});

afterAll(async () => {
  await cleanupAll();
});

async function createPunch(deviceId: string, overrides: Partial<{ webhookAttempts: number; webhookHeld: boolean; lastWebhookError: string | null }> = {}) {
  return prisma.punchRecord.create({
    data: {
      deviceId,
      devicePin: "1",
      punchTime: new Date(),
      status: 0,
      verifyMode: 1,
      rawLine: "raw",
      webhookAttempts: overrides.webhookAttempts ?? 0,
      webhookHeld: overrides.webhookHeld ?? false,
      lastWebhookError: overrides.lastWebhookError ?? null,
    },
  });
}

describe("POST /:id/retry rejects when the device has no active webhook", () => {
  it("device never had a webhook configured (genuinely NA)", async () => {
    const device = await createDevice(company.id); // no webhookUrl by default
    const punch = await createPunch(device.id, { webhookHeld: true });
    const res = await request(app).post(`/api/admin/punch-records/${punch.id}/retry`).set("Cookie", admin.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no active webhook/i);
  });

  it("device HAD a webhook, exhausted retries, webhook was then removed", async () => {
    const device = await createDevice(company.id);
    const punch = await createPunch(device.id, { webhookAttempts: 5, lastWebhookError: "HTTP 500" });
    const res = await request(app).post(`/api/admin/punch-records/${punch.id}/retry`).set("Cookie", admin.cookie);
    expect(res.status).toBe(400);
  });

  it("device HAD a webhook, mid-backoff, webhook was then disabled (not deleted, just toggled off)", async () => {
    const device = await createDevice(company.id);
    await prisma.device.update({
      where: { id: device.id },
      data: { webhookEnabled: false, webhookUrl: "https://example.com/hook" },
    });
    const punch = await createPunch(device.id, { webhookAttempts: 2, lastWebhookError: "timed out" });
    const res = await request(app).post(`/api/admin/punch-records/${punch.id}/retry`).set("Cookie", admin.cookie);
    expect(res.status).toBe(400);
  });

  it("succeeds normally when the device DOES have an active webhook", async () => {
    const device = await createDevice(company.id);
    await prisma.device.update({
      where: { id: device.id },
      data: { webhookEnabled: true, webhookUrl: "https://example.com/hook" },
    });
    const punch = await createPunch(device.id, { webhookAttempts: 5 });
    const res = await request(app).post(`/api/admin/punch-records/${punch.id}/retry`).set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
  });
});

describe("POST /retry-bulk excludes records whose device has no active webhook, without erroring the whole batch", () => {
  it("counts only the eligible ones in the response and only touches those rows", async () => {
    const deviceWithWebhook = await createDevice(company.id);
    await prisma.device.update({
      where: { id: deviceWithWebhook.id },
      data: { webhookEnabled: true, webhookUrl: "https://example.com/hook" },
    });
    const deviceWithoutWebhook = await createDevice(company.id);

    const eligible = await createPunch(deviceWithWebhook.id, { webhookAttempts: 3 });
    const ineligible = await createPunch(deviceWithoutWebhook.id, { webhookAttempts: 3, lastWebhookError: "HTTP 500" });
    const beforeIneligible = await prisma.punchRecord.findUnique({ where: { id: ineligible.id } });

    const res = await request(app)
      .post("/api/admin/punch-records/retry-bulk")
      .set("Cookie", admin.cookie)
      .send({ ids: [eligible.id, ineligible.id] });

    expect(res.status).toBe(200);
    expect(res.body.retried).toBe(1);
    const afterIneligible = await prisma.punchRecord.findUnique({ where: { id: ineligible.id } });
    expect(afterIneligible?.nextAttemptAt).toEqual(beforeIneligible?.nextAttemptAt);
  });
});

describe("the list API's canRetry field matches the retry endpoint's actual behavior", () => {
  it("canRetry is false for a device with no active webhook, true for one with an active webhook", async () => {
    const deviceNo = await createDevice(company.id);
    const deviceYes = await createDevice(company.id);
    await prisma.device.update({
      where: { id: deviceYes.id },
      data: { webhookEnabled: true, webhookUrl: "https://example.com/hook" },
    });
    await createPunch(deviceNo.id, { webhookAttempts: 5, lastWebhookError: "HTTP 500" });
    await createPunch(deviceYes.id, { webhookAttempts: 5, lastWebhookError: "HTTP 500" });

    const res = await request(app)
      .get(`/api/admin/punch-records?deviceId=${deviceNo.id}`)
      .set("Cookie", admin.cookie);
    expect(res.body.records[0].canRetry).toBe(false);
    expect(res.body.records[0].webhookStatus).toBe("failed"); // the core bug fix - not "not_applicable"

    const res2 = await request(app)
      .get(`/api/admin/punch-records?deviceId=${deviceYes.id}`)
      .set("Cookie", admin.cookie);
    expect(res2.body.records[0].canRetry).toBe(true);
    expect(res2.body.records[0].webhookStatus).toBe("failed");
  });
});

describe("the dedicated Failed Webhooks page never shows a row badged 'not_applicable'", () => {
  it("a mid-backoff record whose webhook was removed appears with a 'failed' badge, not NA", async () => {
    const device = await createDevice(company.id); // no active webhook
    await createPunch(device.id, { webhookAttempts: 1, lastWebhookError: "connection refused" });

    const res = await request(app)
      .get(`/api/admin/punch-records/failed?deviceId=${device.id}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.records.length).toBe(1);
    expect(res.body.records[0].webhookStatus).toBe("failed");
  });
});
