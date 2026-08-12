import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { requireSuperAdmin } from "../middleware/requireAdminAuth";
import { OPTIONS_LIMIT, paginationQuerySchema } from "../utils/pagination";

export const companiesRouter = Router();

// Lightweight, unpaginated (but capped) list for populating <select>
// dropdowns - registered before "/:id" so "options" isn't swallowed as an id.
companiesRouter.get("/options", async (req, res) => {
  if (req.adminUser!.role !== "SUPER_ADMIN") {
    const company = req.adminUser!.companyId
      ? await prisma.company.findUnique({ where: { id: req.adminUser!.companyId }, select: { id: true, name: true } })
      : null;
    res.json({ companies: company ? [company] : [] });
    return;
  }
  const companies = await prisma.company.findMany({
    orderBy: { name: "asc" },
    take: OPTIONS_LIMIT,
    select: { id: true, name: true },
  });
  res.json({ companies });
});

// company_admin only ever sees their own company; super_admin sees all, paginated.
companiesRouter.get("/", async (req, res) => {
  if (req.adminUser!.role !== "SUPER_ADMIN") {
    const company = req.adminUser!.companyId
      ? await prisma.company.findUnique({
          where: { id: req.adminUser!.companyId },
          include: { _count: { select: { devices: true, adminUsers: true } } },
        })
      : null;
    const companies = company ? [company] : [];
    res.json({ companies, total: companies.length, page: 1, pageSize: companies.length || 1 });
    return;
  }

  const parsedQuery = paginationQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid query", details: parsedQuery.error.flatten() });
    return;
  }
  const { page, pageSize } = parsedQuery.data;

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { devices: true, adminUsers: true } } },
    }),
    prisma.company.count(),
  ]);
  res.json({ companies, total, page, pageSize });
});

companiesRouter.get("/:id", async (req, res) => {
  if (req.adminUser!.role !== "SUPER_ADMIN" && req.adminUser!.companyId !== req.params.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { devices: true, adminUsers: true } } },
  });
  if (!company) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ company });
});

const createCompanySchema = z.object({ name: z.string().min(1) });

companiesRouter.post("/", requireSuperAdmin, async (req, res) => {
  const parsed = createCompanySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const company = await prisma.company.create({ data: { name: parsed.data.name } });
  res.status(201).json({ company });
});

const updateCompanySchema = z.object({ name: z.string().min(1) });

companiesRouter.patch("/:id", requireSuperAdmin, async (req, res) => {
  const parsed = updateCompanySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const company = await prisma.company
    .update({ where: { id: req.params.id }, data: { name: parsed.data.name } })
    .catch(() => null);
  if (!company) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ company });
});

companiesRouter.delete("/:id", requireSuperAdmin, async (req, res) => {
  await prisma.company.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
});
