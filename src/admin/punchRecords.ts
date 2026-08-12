import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { config } from "../config";
import { requireSuperAdmin, resolveCompanyScope } from "../middleware/requireAdminAuth";
import { paginationQuerySchema } from "../utils/pagination";

export const punchRecordsRouter = Router();

type WebhookStatus = "delivered" | "pending" | "failed";

function computeStatus(record: { webhookDelivered: boolean; webhookAttempts: number }): WebhookStatus {
  if (record.webhookDelivered) return "delivered";
  if (record.webhookAttempts >= config.webhookMaxAttempts) return "failed";
  return "pending";
}

function serialize<T extends { webhookDelivered: boolean; webhookAttempts: number }>(record: T) {
  return { ...record, webhookStatus: computeStatus(record) };
}

function statusWhereClause(status: WebhookStatus | undefined): Prisma.PunchRecordWhereInput {
  if (status === "delivered") return { webhookDelivered: true };
  if (status === "failed") return { webhookDelivered: false, webhookAttempts: { gte: config.webhookMaxAttempts } };
  if (status === "pending") return { webhookDelivered: false, webhookAttempts: { lt: config.webhookMaxAttempts } };
  return {};
}

const listQuerySchema = z.object({
  companyId: z.string().optional(),
  deviceId: z.string().optional(),
  status: z.enum(["delivered", "pending", "failed"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

async function buildScopedWhere(req: import("express").Request, extra: Prisma.PunchRecordWhereInput) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return { ok: false, error: parsed.error } as const;

  const companyId = resolveCompanyScope(req, parsed.data.companyId);
  const deviceWhere: Prisma.DeviceWhereInput = {};
  if (companyId) deviceWhere.companyId = companyId;

  const where: Prisma.PunchRecordWhereInput = {
    ...extra,
    ...statusWhereClause(parsed.data.status),
    device: Object.keys(deviceWhere).length ? deviceWhere : undefined,
    deviceId: parsed.data.deviceId,
  };

  if (parsed.data.from || parsed.data.to) {
    where.punchTime = {
      ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
      ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {}),
    };
  }

  return { ok: true, where, page: parsed.data.page, pageSize: parsed.data.pageSize } as const;
}

punchRecordsRouter.get("/", async (req, res) => {
  const built = await buildScopedWhere(req, {});
  if (!built.ok) {
    res.status(400).json({ error: "Invalid query", details: built.error.flatten() });
    return;
  }

  const { where, page, pageSize } = built;
  const [records, total] = await Promise.all([
    prisma.punchRecord.findMany({
      where,
      orderBy: { punchTime: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { device: { select: { id: true, serialNumber: true, label: true, companyId: true } } },
    }),
    prisma.punchRecord.count({ where }),
  ]);

  res.json({ records: records.map(serialize), total, page, pageSize });
});

// Dedicated failed-webhooks view: retries exhausted OR most recent attempt errored.
punchRecordsRouter.get("/failed", async (req, res) => {
  const built = await buildScopedWhere(req, {
    webhookDelivered: false,
    OR: [{ webhookAttempts: { gte: config.webhookMaxAttempts } }, { lastWebhookError: { not: null } }],
  });
  if (!built.ok) {
    res.status(400).json({ error: "Invalid query", details: built.error.flatten() });
    return;
  }

  const { where, page, pageSize } = built;
  const [records, total] = await Promise.all([
    prisma.punchRecord.findMany({
      where,
      orderBy: { nextAttemptAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { device: { select: { id: true, serialNumber: true, label: true, companyId: true } } },
    }),
    prisma.punchRecord.count({ where }),
  ]);

  res.json({ records: records.map(serialize), total, page, pageSize });
});

async function assertVisible(req: import("express").Request, punchRecordId: string) {
  const record = await prisma.punchRecord.findUnique({
    where: { id: punchRecordId },
    include: { device: true },
  });
  if (!record) return { record: null } as const;
  if (req.adminUser!.role !== "SUPER_ADMIN" && req.adminUser!.companyId !== record.device.companyId) {
    return { record: null, forbidden: true } as const;
  }
  return { record } as const;
}

punchRecordsRouter.get("/:id/deliveries", async (req, res) => {
  const { record, forbidden } = await assertVisible(req, req.params.id);
  if (forbidden) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!record) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsedQuery = paginationQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid query", details: parsedQuery.error.flatten() });
    return;
  }
  const { page, pageSize } = parsedQuery.data;

  // Repeated manual "Retry now" clicks can pile up attempts well past
  // WEBHOOK_MAX_ATTEMPTS, so this can't be assumed bounded - paginate it.
  const where = { punchRecordId: record.id };
  const [deliveries, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.webhookDelivery.count({ where }),
  ]);

  res.json({ punchRecord: serialize(record), deliveries, total, page, pageSize });
});

// Resets a punch record into the worker's next poll: nextAttemptAt = now(),
// webhookAttempts = 0, so it's picked up on the worker's next tick.
async function resetForRetry(ids: string[]) {
  await prisma.punchRecord.updateMany({
    where: { id: { in: ids } },
    data: { nextAttemptAt: new Date(), webhookAttempts: 0 },
  });
}

punchRecordsRouter.post("/:id/retry", async (req, res) => {
  const { record, forbidden } = await assertVisible(req, req.params.id);
  if (forbidden) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!record) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await resetForRetry([record.id]);
  res.json({ ok: true });
});

const bulkRetrySchema = z.object({ ids: z.array(z.string()).min(1).max(500) });

punchRecordsRouter.post("/retry-bulk", async (req, res) => {
  const parsed = bulkRetrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const companyId = resolveCompanyScope(req, undefined);
  const visibleIds = companyId
    ? (
        await prisma.punchRecord.findMany({
          where: { id: { in: parsed.data.ids }, device: { companyId } },
          select: { id: true },
        })
      ).map((r) => r.id)
    : parsed.data.ids;

  await resetForRetry(visibleIds);
  res.json({ ok: true, retried: visibleIds.length });
});

// Deletion is destructive to attendance history, so it's restricted to
// super_admin regardless of company scope (unlike retry, which company_admin
// can also do on their own records). Cascades to WebhookDelivery rows.
punchRecordsRouter.delete("/:id", requireSuperAdmin, async (req, res) => {
  const deleted = await prisma.punchRecord.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

const bulkDeleteSchema = z.object({ ids: z.array(z.string()).min(1).max(500) });

punchRecordsRouter.post("/delete-bulk", requireSuperAdmin, async (req, res) => {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const result = await prisma.punchRecord.deleteMany({ where: { id: { in: parsed.data.ids } } });
  res.json({ ok: true, deleted: result.count });
});
