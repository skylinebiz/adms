import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db/client";
import { config } from "../config";
import { signAdminToken } from "./jwt";
import { requireAdminAuth } from "../middleware/requireAdminAuth";

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
