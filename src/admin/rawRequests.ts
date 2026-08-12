import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { requireSuperAdmin } from "../middleware/requireAdminAuth";
import { paginationQuerySchema } from "../utils/pagination";

// Unconditional firehose of every /iclock/* request - super_admin only,
// since it isn't scoped to a company/device (that's the point: it's the
// lowest-level "what is actually hitting this server" debug view).
export const rawRequestsRouter = Router();
rawRequestsRouter.use(requireSuperAdmin);

const listQuerySchema = paginationQuerySchema.extend({
  serialNumber: z.string().optional(),
  endpoint: z.string().optional(),
});

rawRequestsRouter.get("/", async (req, res) => {
  const parsedQuery = listQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid query", details: parsedQuery.error.flatten() });
    return;
  }
  const { page, pageSize, serialNumber, endpoint } = parsedQuery.data;
  const where = {
    ...(serialNumber ? { serialNumber } : {}),
    ...(endpoint ? { endpoint } : {}),
  };

  const [requests, total] = await Promise.all([
    prisma.rawRequestLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.rawRequestLog.count({ where }),
  ]);

  res.json({ requests, total, page, pageSize });
});

const bulkDeleteSchema = z.object({ ids: z.array(z.string()).min(1).max(500) });

// Registered before "/:id" so "delete-bulk" isn't swallowed as an :id -
// moot for DELETE (different method/router below) but kept consistent with
// the pattern used elsewhere in this codebase.
rawRequestsRouter.post("/delete-bulk", async (req, res) => {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const result = await prisma.rawRequestLog.deleteMany({ where: { id: { in: parsed.data.ids } } });
  res.json({ ok: true, deleted: result.count });
});

rawRequestsRouter.delete("/:id", async (req, res) => {
  const deleted = await prisma.rawRequestLog.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});
