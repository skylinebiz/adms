import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db/client";
import { config } from "../config";
import { signAdminToken } from "./jwt";
import { requireAdminAuth } from "../middleware/requireAdminAuth";
import { slugSchema } from "../utils/slug";
import { getOrCreatePlatformSettings } from "../utils/retention";
import { clientIp, createRateLimiter, rateLimitByIp, sendRateLimited } from "../middleware/rateLimit";

export const authRouter = Router();

const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // matches JWT TTL

function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(config.adminSessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

function toPublicUser(user: {
  id: string;
  email: string;
  role: string;
  companyId: string | null;
  mustChangePassword: boolean;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    mustChangePassword: user.mustChangePassword,
  };
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

// Only FAILED logins count, so a legitimate user is never locked out by
// normal use; a success clears that email's counter. Per-IP stops one source
// spraying many accounts, per-email stops many sources hammering one account.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginIpLimiter = createRateLimiter({ windowMs: LOGIN_WINDOW_MS, max: 30 });
const loginEmailLimiter = createRateLimiter({ windowMs: LOGIN_WINDOW_MS, max: 10 });

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;
  const ip = clientIp(req);
  const emailKey = email.toLowerCase();
  const ipCheck = loginIpLimiter.check(ip);
  const emailCheck = loginEmailLimiter.check(emailKey);
  if (!ipCheck.allowed || !emailCheck.allowed) {
    sendRateLimited(
      res,
      Math.max(ipCheck.retryAfterSec, emailCheck.retryAfterSec),
      "Too many failed login attempts. Try again later."
    );
    return;
  }

  const user = await prisma.adminUser.findUnique({ where: { email } });
  // bcrypt.compare is skipped for unknown emails (as before); both branches
  // still count as a failure here.
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !valid) {
    loginIpLimiter.hit(ip);
    loginEmailLimiter.hit(emailKey);
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  loginEmailLimiter.reset(emailKey);

  const token = signAdminToken({
    sub: user.id,
    email: user.email,
    role: user.role as "SUPER_ADMIN" | "COMPANY_ADMIN",
    companyId: user.companyId,
  });
  setSessionCookie(res, token);
  res.json({ user: toPublicUser(user) });
});

// Public self-signup: creates a brand new Company plus its first
// AdminUser (COMPANY_ADMIN) in one transaction, no super_admin involved.
// Reuses the exact session-issuing code /login uses so the new user lands
// straight in their dashboard, already authenticated.
const signupSchema = z.object({
  companyName: z.string().min(1),
  slug: slugSchema,
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Public - lets the login/signup screens hide or replace the signup form
// when a super_admin has turned self-signup off (Settings -> Public signups).
authRouter.get("/signup-status", async (_req, res) => {
  const { signupsEnabled } = await getOrCreatePlatformSettings(prisma);
  res.json({ signupsEnabled });
});

// Every attempt counts (not just successes), so a script probing slugs/emails
// is throttled as hard as one creating accounts.
const signupRateLimit = rateLimitByIp({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many signup attempts from this address. Try again later.",
});

authRouter.post("/signup", signupRateLimit, async (req, res) => {
  // Checked server-side, ahead of validation - hiding the form in the UI
  // is only a convenience, not the enforcement.
  const { signupsEnabled } = await getOrCreatePlatformSettings(prisma);
  if (!signupsEnabled) {
    res.status(403).json({ error: "Public signups are currently disabled" });
    return;
  }
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const { companyName, slug, email, password } = parsed.data;

  // Pre-checks for clean, field-specific 409s. Not required for
  // correctness (the P2002 catch below is the real guarantee) - just
  // avoids depending on Prisma's err.meta.target shape to tell slug and
  // email conflicts apart.
  const [slugTaken, emailTaken] = await Promise.all([
    prisma.company.findUnique({ where: { slug }, select: { id: true } }),
    prisma.adminUser.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (slugTaken) {
    res.status(409).json({ error: "That company URL is already taken" });
    return;
  }
  if (emailTaken) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma
    .$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: companyName, slug } });
      return tx.adminUser.create({
        data: { email, passwordHash, role: "COMPANY_ADMIN", companyId: company.id },
      });
    })
    .catch((err) => {
      // Race-condition safety net only (two concurrent signups for the
      // same slug/email landing between the pre-checks above and this
      // transaction committing).
      if (err?.code === "P2002") return "conflict" as const;
      throw err;
    });

  if (user === "conflict") {
    res.status(409).json({ error: "That company URL or email is already taken" });
    return;
  }

  const token = signAdminToken({
    sub: user.id,
    email: user.email,
    role: "COMPANY_ADMIN",
    companyId: user.companyId,
  });
  setSessionCookie(res, token);
  res.status(201).json({ user: toPublicUser(user) });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(config.adminSessionCookieName, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAdminAuth, async (req, res) => {
  const user = await prisma.adminUser.findUnique({ where: { id: req.adminUser!.id } });
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ user: toPublicUser(user) });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

authRouter.patch("/me/password", requireAdminAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const user = await prisma.adminUser.findUnique({ where: { id: req.adminUser!.id } });
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.adminUser.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  res.json({ ok: true });
});
