import { describe, expect, it } from "vitest";
import { computeStatus, hasActiveWebhook, statusCondition } from "../src/admin/punchRecords";
import { config } from "../src/config";

// Regression coverage for a real bug: removing/disabling a device's webhook
// used to silently flip EVERY one of its non-delivered punch records to
// "not_applicable" (NA), discarding whether they'd actually been attempted
// and failed. The fix: NA means "never had a shot and still can't" - once
// a record has been attempted at least once, it keeps reporting on that
// history (failed) regardless of the device's current webhook config.

const activeWebhook = { webhookEnabled: true, webhookUrl: "https://example.com/hook" };
const noWebhookUrl = { webhookEnabled: true, webhookUrl: null };
const disabledWebhook = { webhookEnabled: false, webhookUrl: "https://example.com/hook" };
const noWebhookAtAll = { webhookEnabled: false, webhookUrl: null };

describe("hasActiveWebhook", () => {
  it("requires both enabled AND a URL", () => {
    expect(hasActiveWebhook(activeWebhook)).toBe(true);
    expect(hasActiveWebhook(noWebhookUrl)).toBe(false);
    expect(hasActiveWebhook(disabledWebhook)).toBe(false);
    expect(hasActiveWebhook(noWebhookAtAll)).toBe(false);
  });
});

describe("computeStatus", () => {
  it("delivered wins regardless of anything else", () => {
    expect(
      computeStatus({ webhookDelivered: true, webhookAttempts: 0, webhookHeld: true }, noWebhookAtAll)
    ).toBe("delivered");
  });

  it("held (never had a shot at ingestion, never retried) is NA even if a webhook exists now", () => {
    expect(
      computeStatus({ webhookDelivered: false, webhookAttempts: 0, webhookHeld: true }, activeWebhook)
    ).toBe("not_applicable");
  });

  it("no webhook + zero attempts is NA (nothing has happened, nothing to show)", () => {
    expect(
      computeStatus({ webhookDelivered: false, webhookAttempts: 0, webhookHeld: false }, noWebhookAtAll)
    ).toBe("not_applicable");
  });

  it("THE BUG: a record that exhausted max attempts stays 'failed' after the webhook is removed, not NA", () => {
    const record = { webhookDelivered: false, webhookAttempts: config.webhookMaxAttempts, webhookHeld: false };
    expect(computeStatus(record, activeWebhook)).toBe("failed");
    expect(computeStatus(record, noWebhookAtAll)).toBe("failed");
    expect(computeStatus(record, disabledWebhook)).toBe("failed");
  });

  it("a mid-backoff record (attempts > 0 but below max) is 'pending' with an active webhook, but 'failed' once the webhook is removed", () => {
    const record = { webhookDelivered: false, webhookAttempts: 2, webhookHeld: false };
    expect(config.webhookMaxAttempts).toBeGreaterThan(2); // sanity: this is genuinely mid-backoff, not already-exhausted
    expect(computeStatus(record, activeWebhook)).toBe("pending");
    expect(computeStatus(record, noWebhookAtAll)).toBe("failed");
  });

  it("attempts below max with an active webhook is pending", () => {
    expect(
      computeStatus({ webhookDelivered: false, webhookAttempts: 1, webhookHeld: false }, activeWebhook)
    ).toBe("pending");
  });
});

describe("statusCondition mirrors computeStatus for every combination (query filter must agree with the badge)", () => {
  const fixtures: Array<{
    label: string;
    record: { webhookDelivered: boolean; webhookAttempts: number; webhookHeld: boolean };
    device: { webhookEnabled: boolean; webhookUrl: string | null };
  }> = [
    { label: "delivered", record: { webhookDelivered: true, webhookAttempts: 0, webhookHeld: false }, device: activeWebhook },
    { label: "held, webhook active now", record: { webhookDelivered: false, webhookAttempts: 0, webhookHeld: true }, device: activeWebhook },
    { label: "zero attempts, no webhook", record: { webhookDelivered: false, webhookAttempts: 0, webhookHeld: false }, device: noWebhookAtAll },
    { label: "exhausted, webhook active", record: { webhookDelivered: false, webhookAttempts: 5, webhookHeld: false }, device: activeWebhook },
    { label: "exhausted, webhook removed", record: { webhookDelivered: false, webhookAttempts: 5, webhookHeld: false }, device: noWebhookAtAll },
    { label: "mid-backoff, webhook active", record: { webhookDelivered: false, webhookAttempts: 2, webhookHeld: false }, device: activeWebhook },
    { label: "mid-backoff, webhook disabled", record: { webhookDelivered: false, webhookAttempts: 2, webhookHeld: false }, device: disabledWebhook },
    { label: "mid-backoff, url cleared", record: { webhookDelivered: false, webhookAttempts: 2, webhookHeld: false }, device: noWebhookUrl },
    { label: "pending, low attempts", record: { webhookDelivered: false, webhookAttempts: 1, webhookHeld: false }, device: activeWebhook },
  ];

  for (const status of ["delivered", "pending", "failed", "not_applicable"] as const) {
    it(`every fixture matches statusCondition("${status}") exactly when computeStatus says "${status}"`, () => {
      const where = statusCondition(status);
      for (const { label, record, device } of fixtures) {
        const expected = computeStatus(record, device) === status;
        const actual = matchesPrismaWhere(where, record, device);
        expect(actual, `${label}: expected statusCondition("${status}") match = ${expected}`).toBe(expected);
      }
    });
  }

  // Evaluates a Prisma PunchRecordWhereInput against an in-memory
  // record+device pair, without touching the database - this is checking
  // that the query WOULD select the same rows computeStatus WOULD badge as
  // that status, so both stay in agreement as the rule evolves.
  function matchesPrismaWhere(where: any, record: any, device: any): boolean {
    // Every key on a Prisma where-object is implicitly ANDed together,
    // AND/OR/device included - a where-object with both an AND array and
    // sibling field keys (as statusCondition("pending") has) requires ALL
    // of them, not just the AND branch.
    return Object.entries(where).every(([key, cond]: [string, any]) => {
      if (key === "AND") return cond.every((c: any) => matchesPrismaWhere(c, record, device));
      if (key === "OR") return cond.some((c: any) => matchesPrismaWhere(c, record, device));
      if (key === "device") return matchesPrismaWhere(cond, record, device);
      const value = record[key] !== undefined ? record[key] : device[key];
      if (cond && typeof cond === "object" && !Array.isArray(cond)) {
        if ("gte" in cond) return value >= cond.gte;
        if ("lt" in cond) return value < cond.lt;
        if ("gt" in cond) return value > cond.gt;
        if ("not" in cond) return value !== cond.not;
      }
      return value === cond;
    });
  }
});
