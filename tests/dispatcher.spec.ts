import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTemplateVars, dispatchWebhook } from "../src/webhooks/dispatcher";
import { renderBodyTemplate, renderHeaders, SAMPLE_TEMPLATE_VARS } from "../src/webhooks/template";
import { erpnextEmployeeCheckin } from "../src/webhooks/templates/erpnext";

const punch = {
  devicePin: "7",
  punchTime: new Date(Date.UTC(2024, 6, 28, 1, 25, 24)), // literal wall-clock digits, not a real instant
  punchTimeUtc: null,
  status: 0,
  verifyMode: 1,
  workCode: null,
  receivedAt: new Date(Date.UTC(2026, 7, 12, 12, 0, 0)),
};

const device = { id: "dev1", companyId: "co1", serialNumber: "BOCK200961014", timezone: null };

describe("buildTemplateVars punch_time_frappe", () => {
  it("formats the device's literal wall-clock digits as a naive Frappe/ERPNext timestamp", () => {
    const vars = buildTemplateVars(punch, device, "Acme");
    expect(vars.punch_time_frappe).toBe("2024-07-28 01:25:24.000000");
  });

  it("pads single-digit month/day/hour/minute/second", () => {
    const vars = buildTemplateVars(
      { ...punch, punchTime: new Date(Date.UTC(2024, 0, 5, 3, 4, 5)) },
      device,
      "Acme"
    );
    expect(vars.punch_time_frappe).toBe("2024-01-05 03:04:05.000000");
  });

  it("does not depend on a configured device timezone", () => {
    const vars = buildTemplateVars(punch, { ...device, timezone: "Asia/Kolkata" }, "Acme");
    expect(vars.punch_time_frappe).toBe("2024-07-28 01:25:24.000000");
  });
});

describe("erpnext webhook template", () => {
  it("renders a valid add_log_based_on_employee_field body with real punch data substituted", () => {
    const body = renderBodyTemplate(erpnextEmployeeCheckin.bodyTemplate, SAMPLE_TEMPLATE_VARS) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({
      employee_field_value: SAMPLE_TEMPLATE_VARS.pin,
      timestamp: SAMPLE_TEMPLATE_VARS.punch_time_frappe,
      device_id: SAMPLE_TEMPLATE_VARS.device_serial,
      log_type: "Auto",
    });
  });

  it("carries the Frappe token-auth header format", () => {
    const headers = renderHeaders(erpnextEmployeeCheckin.headers, SAMPLE_TEMPLATE_VARS);
    expect(headers.Authorization).toMatch(/^token /);
  });
});

describe("dispatchWebhook echoes back exactly what it sent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("on success, requestBody/requestHeaders match the actual fetch call, including the computed signature", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("thanks") });
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchWebhook(
      "https://example.com/hook",
      "my-secret",
      { event: "punch.created", pin: "1" },
      5000,
      { "X-Custom": "abc" }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(result.requestBody).toBe(init.body);
    expect(result.requestHeaders).toEqual(init.headers);
    expect(result.requestHeaders["Content-Type"]).toBe("application/json");
    expect(result.requestHeaders["X-Custom"]).toBe("abc");
    expect(result.requestHeaders["X-Webhook-Signature"]).toMatch(/^sha256=/);
    expect(JSON.parse(result.requestBody)).toEqual({ event: "punch.created", pin: "1" });
  });

  it("on a failed/unreachable request, still reports what WOULD have been sent (not null)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );

    const result = await dispatchWebhook("https://example.com/hook", null, { a: 1 }, 5000);
    expect(result.success).toBe(false);
    expect(result.requestBody).toBe(JSON.stringify({ a: 1 }));
    expect(result.requestHeaders["Content-Type"]).toBe("application/json");
    expect(result.requestHeaders["X-Webhook-Signature"]).toBeUndefined(); // no secret configured
  });
});
