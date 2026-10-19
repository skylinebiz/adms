import { NextFunction, Request, Response } from "express";

// Fixed-window, in-memory rate limiter. State lives in this process only, so
// limits are per server instance and reset on restart - fine for a single
// container deployment, and it keeps the abuse protection dependency-free.
// If the app is ever scaled to several instances, swap the Map for a shared
// store (Redis/Postgres) behind the same interface.
export interface RateLimiter {
  // True if `key` is still under its limit (does not count a hit).
  check(key: string): { allowed: boolean; retryAfterSec: number };
  // Counts one hit against `key`.
  hit(key: string): void;
  // Forgets `key` (e.g. after a successful login).
  reset(key: string): void;
}

export function createRateLimiter(opts: { windowMs: number; max: number }): RateLimiter {
  const entries = new Map<string, { count: number; resetAt: number }>();

  // Drop expired windows so the Map can't grow without bound under a flood of
  // distinct keys. unref() so this timer never keeps the process alive.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
  }, Math.min(opts.windowMs, 60_000));
  sweep.unref();

  function live(key: string) {
    const entry = entries.get(key);
    if (entry && entry.resetAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    check(key) {
      const entry = live(key);
      if (!entry || entry.count < opts.max) return { allowed: true, retryAfterSec: 0 };
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000)) };
    },
    hit(key) {
      const entry = live(key);
      if (entry) entry.count += 1;
      else entries.set(key, { count: 1, resetAt: Date.now() + opts.windowMs });
    },
    reset(key) {
      entries.delete(key);
    },
  };
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function sendRateLimited(res: Response, retryAfterSec: number, message: string) {
  res.setHeader("Retry-After", String(retryAfterSec));
  res.status(429).json({ error: message });
}

// Middleware that counts every request against the caller's IP.
export function rateLimitByIp(opts: { windowMs: number; max: number; message: string }) {
  const limiter = createRateLimiter(opts);
  return (req: Request, res: Response, next: NextFunction) => {
    const key = clientIp(req);
    const { allowed, retryAfterSec } = limiter.check(key);
    if (!allowed) {
      sendRateLimited(res, retryAfterSec, opts.message);
      return;
    }
    limiter.hit(key);
    next();
  };
}
