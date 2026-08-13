import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db/client";
import { config } from "../config";
import { signAdminToken } from "./jwt";
import { requireAdminAuth } from "../middleware/requireAdminAuth";
import { slugSchema } from "../utils/slug";

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
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

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
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

authRouter.post("/signup", async (req, res) => {
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
