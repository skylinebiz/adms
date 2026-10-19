import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createRateLimiter, rateLimitByIp } from "../src/middleware/rateLimit";

describe("createRateLimiter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows up to max hits, then blocks with a retry time", () => {
    const l = createRateLimiter({ windowMs: 60_000, max: 3 });
    for (let i = 0; i < 3; i++) {
      expect(l.check("a").allowed).toBe(true);
      l.hit("a");
    }
    const r = l.check("a");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBe(60);
  });

  it("tracks keys independently", () => {
    const l = createRateLimiter({ windowMs: 60_000, max: 1 });
    l.hit("a");
    expect(l.check("a").allowed).toBe(false);
    expect(l.check("b").allowed).toBe(true);
  });

  it("opens a fresh window after it expires", () => {
    const l = createRateLimiter({ windowMs: 60_000, max: 1 });
    l.hit("a");
    vi.advanceTimersByTime(60_001);
    expect(l.check("a").allowed).toBe(true);
  });

  it("reset clears a key", () => {
    const l = createRateLimiter({ windowMs: 60_000, max: 1 });
    l.hit("a");
    l.reset("a");
    expect(l.check("a").allowed).toBe(true);
  });
});

describe("rateLimitByIp middleware", () => {
  it("returns 429 with Retry-After once the limit is exceeded", async () => {
    const app = express();
    app.post("/x", rateLimitByIp({ windowMs: 60_000, max: 2, message: "slow down" }), (_req, res) => {
      res.json({ ok: true });
    });
    await request(app).post("/x").expect(200);
    await request(app).post("/x").expect(200);
    const res = await request(app).post("/x").expect(429);
    expect(res.body.error).toBe("slow down");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });
});
