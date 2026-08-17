import { describe, expect, it } from "vitest";
import { buildTemplateVars } from "../src/webhooks/dispatcher";
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
