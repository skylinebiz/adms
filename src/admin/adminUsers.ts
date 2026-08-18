import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db/client";
import { requireSuperAdmin, resolveCompanyScope } from "../middleware/requireAdminAuth";
import { paginationQuerySchema } from "../utils/pagination";

export const adminUsersRouter = Router();

function toPublicUser(user: {
  id: string;
  email: string;
  role: string;
  companyId: string | null;
  mustChangePassword: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  };
}

// company_admin can only see/manage admin users within their own company.
// super_admin sees everyone, optionally filtered by ?companyId=.
adminUsersRouter.get("/", async (req, res) => {
  const parsedQuery = paginationQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid query", details: parsedQuery.error.flatten() });
    return;
  }
  const { page, pageSize } = parsedQuery.data;

  const scope = resolveCompanyScope(req, req.query.companyId as string | undefined);
  const where = scope.all ? {} : { companyId: scope.companyId };

  const [users, total] = await Promise.all([
    prisma.adminUser.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.adminUser.count({ where }),
  ]);
  res.json({ adminUsers: users.map(toPublicUser), total, page, pageSize });
});

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["SUPER_ADMIN", "COMPANY_ADMIN"]),
  companyId: z.string().nullable().optional(),
});

adminUsersRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const { email, password, role, companyId } = parsed.data;

  if (req.adminUser!.role !== "SUPER_ADMIN") {
    if (role === "SUPER_ADMIN" || companyId !== req.adminUser!.companyId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
  if (role === "COMPANY_ADMIN" && !companyId) {
    res.status(400).json({ error: "companyId is required for company_admin role" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.adminUser
    .create({
      data: { email, passwordHash, role, companyId: role === "SUPER_ADMIN" ? null : companyId ?? null },
    })
    .catch((err) => {
      if (err?.code === "P2002") return "conflict" as const;
      // A well-formed but nonexistent companyId trips the FK constraint
      // rather than any check above (a company_admin's companyId is
      // already forced to match their own real company, but a super_admin
      // is exempt from that check and can send any string here) - without
      // this it would propagate as an unhandled rejection and surface as a
      // generic 500 instead of a clean rejection of the bad input.
      if (err?.code === "P2003") return "no-such-company" as const;
      throw err;
    });

  if (user === "conflict") {
    res.status(409).json({ error: "An admin user with this email already exists" });
    return;
  }
  if (user === "no-such-company") {
    res.status(400).json({ error: "companyId does not refer to an existing company" });
    return;
  }
  res.status(201).json({ adminUser: toPublicUser(user) });
});

const updateSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(["SUPER_ADMIN", "COMPANY_ADMIN"]).optional(),
  companyId: z.string().nullable().optional(),
});

adminUsersRouter.patch("/:id", requireSuperAdmin, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Validate the *resulting* state, not just the patch in isolation - a
  // request could leave role untouched (already COMPANY_ADMIN) while
  // clearing companyId, or set role to COMPANY_ADMIN while companyId stays
  // unset. Either produces a company_admin session with no company, which
  // requireAdminAuth now rejects outright - better to reject the edit here
  // with a clear 400 than let the admin end up locked out.
  const nextRole = parsed.data.role ?? existing.role;
  const nextCompanyId = "companyId" in parsed.data ? parsed.data.companyId : existing.companyId;
  if (nextRole === "COMPANY_ADMIN" && !nextCompanyId) {
    res.status(400).json({ error: "companyId is required for company_admin role" });
    return;
  }

  const user = await prisma.adminUser
    .update({ where: { id: req.params.id }, data: parsed.data })
    .catch(() => null);
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ adminUser: toPublicUser(user) });
});

adminUsersRouter.delete("/:id", requireSuperAdmin, async (req, res) => {
  await prisma.adminUser.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
});

// Admin-initiated password reset - no current password required. Restricted
// to super_admin so a company_admin can't reset another admin's credentials.
const resetPasswordSchema = z.object({ newPassword: z.string().min(8) });

adminUsersRouter.post("/:id/reset-password", requireSuperAdmin, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  const user = await prisma.adminUser
    .update({ where: { id: req.params.id }, data: { passwordHash, mustChangePassword: true } })
    .catch(() => null);
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});
