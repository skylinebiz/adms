import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { requireSuperAdmin } from "../middleware/requireAdminAuth";
import { Prisma } from "@prisma/client";
import { buildOrderBy, buildSearch, dataTableQuerySchema, SortColumns } from "../utils/datatable";

// Unconditional firehose of every /iclock/* request - super_admin only,
// since it isn't scoped to a company/device (that's the point: it's the
// lowest-level "what is actually hitting this server" debug view).
export const rawRequestsRouter = Router();
rawRequestsRouter.use(requireSuperAdmin);

const listQuerySchema = dataTableQuerySchema.extend({
  serialNumber: z.string().optional(),
  endpoint: z.string().optional(),
});

// Sortable columns - each backed by an index (see schema.prisma). Method
// and body size are deliberately not sortable: method has a handful of
// distinct values, and body size is computed, not stored.
const sortColumns = {
  createdAt: (dir) => ({ createdAt: dir }),
  serialNumber: (dir) => ({ serialNumber: dir }),
  endpoint: (dir) => ({ endpoint: dir }),
} satisfies SortColumns<Prisma.RawRequestLogOrderByWithRelationInput>;

rawRequestsRouter.get("/", async (req, res) => {
  const parsedQuery = listQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid query", details: parsedQuery.error.flatten() });
    return;
  }
  const { page, pageSize, sortBy, sortDir, search, serialNumber, endpoint } = parsedQuery.data;
  const where: Prisma.RawRequestLogWhereInput = {
    ...(serialNumber ? { serialNumber } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...buildSearch<Prisma.RawRequestLogWhereInput>(search, [(t) => ({ serialNumber: t }), (t) => ({ endpoint: t })]),
  };

  const [requests, total] = await Promise.all([
    prisma.rawRequestLog.findMany({
      where,
      orderBy: buildOrderBy<Prisma.RawRequestLogOrderByWithRelationInput>(sortBy, sortDir, sortColumns, [{ createdAt: "desc" }]),
      skip: (page - 1) * pageSize,
      take: pageSize,
      // The body can be up to ADMS_MAX_BODY_SIZE - never ship it in the list.
      // It's fetched on demand via GET /:id when a row's details are opened.
      select: { id: true, serialNumber: true, endpoint: true, method: true, query: true, headers: true, createdAt: true },
    }),
    prisma.rawRequestLog.count({ where }),
  ]);

  // Body size is computed in the database so the list never loads the bodies.
  const sizes = requests.length
    ? await prisma.$queryRaw<{ id: string; size: number }[]>`
        SELECT id, COALESCE(char_length("rawBody"), 0)::int AS size
        FROM raw_request_logs
        WHERE id IN (${Prisma.join(requests.map((r) => r.id))})`
    : [];
  const sizeById = new Map(sizes.map((s) => [s.id, s.size]));

  res.json({
    requests: requests.map((r) => ({ ...r, bodySize: sizeById.get(r.id) ?? 0 })),
    total,
    page,
    pageSize,
  });
});

rawRequestsRouter.get("/:id", async (req, res) => {
  const request = await prisma.rawRequestLog.findUnique({ where: { id: req.params.id } });
  if (!request) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ request });
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
