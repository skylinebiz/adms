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
