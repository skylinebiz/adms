import { describe, expect, it } from "vitest";
import { isValidSlugFormat } from "../src/utils/slug";

describe("isValidSlugFormat", () => {
  it("accepts lowercase letters, digits, and single hyphens", () => {
    expect(isValidSlugFormat("acme-corp")).toBe(true);
    expect(isValidSlugFormat("acme123")).toBe(true);
  });

  it("rejects too short / too long", () => {
    expect(isValidSlugFormat("ab")).toBe(false);
    expect(isValidSlugFormat("a".repeat(64))).toBe(false);
  });

  it("rejects uppercase and invalid characters", () => {
    expect(isValidSlugFormat("Acme")).toBe(false);
    expect(isValidSlugFormat("acme_corp")).toBe(false);
    expect(isValidSlugFormat("acme corp")).toBe(false);
  });

  it("rejects leading/trailing/double hyphens", () => {
    expect(isValidSlugFormat("-acme")).toBe(false);
    expect(isValidSlugFormat("acme-")).toBe(false);
    expect(isValidSlugFormat("ac--me")).toBe(false);
  });

  it("rejects reserved words", () => {
    expect(isValidSlugFormat("admin")).toBe(false);
    expect(isValidSlugFormat("api")).toBe(false);
    expect(isValidSlugFormat("health")).toBe(false);
  });
});
