import { describe, expect, it } from "vitest";
import { renderBodyTemplate, renderHeaders, SAMPLE_TEMPLATE_VARS } from "../src/webhooks/template";

describe("renderBodyTemplate", () => {
  it("substitutes an exact placeholder leaf with the raw typed value", () => {
    const rendered = renderBodyTemplate({ employee_id: "{{pin}}", code: "{{status}}" }, SAMPLE_TEMPLATE_VARS) as any;
    expect(rendered.employee_id).toBe("1");
    expect(rendered.code).toBe(0);
    expect(typeof rendered.code).toBe("number");
  });

  it("interpolates a placeholder embedded in a larger string", () => {
    const rendered = renderBodyTemplate({ note: "Punch by {{pin}} at {{punch_time}}" }, SAMPLE_TEMPLATE_VARS) as any;
    expect(rendered.note).toBe("Punch by 1 at 2024-07-28T01:25:24.000Z");
  });

  it("recurses into nested objects and arrays", () => {
    const rendered = renderBodyTemplate(
      { user: { id: "{{pin}}", tags: ["{{device_serial}}", "static"] } },
      SAMPLE_TEMPLATE_VARS
    ) as any;
    expect(rendered.user.id).toBe("1");
    expect(rendered.user.tags).toEqual(["BOCK200961014", "static"]);
  });

  it("leaves unknown placeholders untouched", () => {
    const rendered = renderBodyTemplate({ x: "{{not_a_real_var}}" }, SAMPLE_TEMPLATE_VARS) as any;
    expect(rendered.x).toBe("{{not_a_real_var}}");
  });

  it("renders null work_code as empty string when interpolated in a larger string", () => {
    const rendered = renderBodyTemplate({ note: "code=[{{work_code}}]" }, SAMPLE_TEMPLATE_VARS) as any;
    expect(rendered.note).toBe("code=[]");
  });

  it("passes through an exact placeholder with a null value as null", () => {
    const rendered = renderBodyTemplate({ work_code: "{{work_code}}" }, SAMPLE_TEMPLATE_VARS) as any;
    expect(rendered.work_code).toBeNull();
  });

  it("leaves non-string leaves (numbers, booleans) untouched", () => {
    const rendered = renderBodyTemplate({ n: 42, b: true, z: null }, SAMPLE_TEMPLATE_VARS) as any;
    expect(rendered).toEqual({ n: 42, b: true, z: null });
  });
});

describe("renderHeaders", () => {
  it("interpolates placeholders in header values", () => {
    const rendered = renderHeaders({ "X-Device-Serial": "{{device_serial}}", "X-Static": "abc" }, SAMPLE_TEMPLATE_VARS);
    expect(rendered).toEqual({ "X-Device-Serial": "BOCK200961014", "X-Static": "abc" });
  });

  it("returns an empty object for null/undefined headers", () => {
    expect(renderHeaders(null, SAMPLE_TEMPLATE_VARS)).toEqual({});
    expect(renderHeaders(undefined, SAMPLE_TEMPLATE_VARS)).toEqual({});
  });
});
