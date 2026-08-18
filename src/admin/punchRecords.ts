import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { config } from "../config";
import { requireSuperAdmin, resolveCompanyScope } from "../middleware/requireAdminAuth";
import { paginationQuerySchema } from "../utils/pagination";

export const punchRecordsRouter = Router();

type WebhookStatus = "delivered" | "pending" | "failed" | "not_applicable";

interface DeviceWebhookInfo {
  webhookUrl: string | null;
  webhookEnabled: boolean;
}

const deviceSelect = { id: true, serialNumber: true, label: true, companyId: true, webhookUrl: true, webhookEnabled: true };

// "not_applicable" covers two cases that both mean "nothing will happen
// automatically right now": the record was held back at ingestion because
// the device had no webhook yet, or the device currently has no webhook
// (regardless of held) - e.g. it was disabled after previously failing.
function computeStatus(
  record: { webhookDelivered: boolean; webhookAttempts: number; webhookHeld: boolean },
  device: DeviceWebhookInfo
): WebhookStatus {
  if (record.webhookDelivered) return "delivered";
  const hasWebhook = device.webhookEnabled && Boolean(device.webhookUrl);
  if (record.webhookHeld || !hasWebhook) return "not_applicable";
  if (record.webhookAttempts >= config.webhookMaxAttempts) return "failed";
  return "pending";
}

function serializeRecord<
  T extends {
    webhookDelivered: boolean;
    webhookAttempts: number;
    webhookHeld: boolean;
    device: DeviceWebhookInfo & { id: string; serialNumber: string; label: string | null; companyId: string };
  }
>(record: T) {
  const { device, ...rest } = record;
  return {
    ...rest,
    webhookStatus: computeStatus(record, device),
    device: { id: device.id, serialNumber: device.serialNumber, label: device.label, companyId: device.companyId },
  };
}

function statusCondition(status: WebhookStatus | undefined): Prisma.PunchRecordWhereInput {
  if (status === "delivered") return { webhookDelivered: true };
  if (status === "not_applicable") {
    return {
      webhookDelivered: false,
      OR: [{ webhookHeld: true }, { device: { OR: [{ webhookEnabled: false }, { webhookUrl: null }] } }],
    };
  }
  if (status === "failed") {
    return {
      webhookDelivered: false,
      webhookHeld: false,
      device: { webhookEnabled: true, webhookUrl: { not: null } },
      webhookAttempts: { gte: config.webhookMaxAttempts },
    };
  }
  if (status === "pending") {
    return {
      webhookDelivered: false,
      webhookHeld: false,
      device: { webhookEnabled: true, webhookUrl: { not: null } },
      webhookAttempts: { lt: config.webhookMaxAttempts },
    };
  }
  return {};
}

const listQuerySchema = z.object({
  companyId: z.string().optional(),
  deviceId: z.string().optional(),
  status: z.enum(["delivered", "pending", "failed", "not_applicable"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// Each condition below is a separate item in an AND array (rather than
// merged keys on one object) so that multiple independent `device: {...}`
// filters - company scoping, status-based webhook-config checks - can
// coexist without one silently clobbering another.
async function buildScopedWhere(req: import("express").Request, extra: Prisma.PunchRecordWhereInput) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return { ok: false, error: parsed.error } as const;

  const scope = resolveCompanyScope(req, parsed.data.companyId);

  const conditions: Prisma.PunchRecordWhereInput[] = [extra, statusCondition(parsed.data.status)];
  if (!scope.all) conditions.push({ device: { companyId: scope.companyId } });
  if (parsed.data.deviceId) conditions.push({ deviceId: parsed.data.deviceId });
  if (parsed.data.from || parsed.data.to) {
    conditions.push({
      punchTime: {
        ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
        ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {}),
      },
    });
  }

  return { ok: true, where: { AND: conditions }, page: parsed.data.page, pageSize: parsed.data.pageSize } as const;
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
      include: { device: { select: deviceSelect } },
    }),
    prisma.punchRecord.count({ where }),
  ]);

  res.json({ records: records.map(serializeRecord), total, page, pageSize });
});

// Dedicated failed-webhooks view: retries exhausted OR most recent attempt errored.
// (Held/NA records naturally never match this - they never accumulate
// attempts or errors while held back from delivery.)
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
      include: { device: { select: deviceSelect } },
    }),
    prisma.punchRecord.count({ where }),
  ]);

  res.json({ records: records.map(serializeRecord), total, page, pageSize });
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

  res.json({ punchRecord: serializeRecord(record), deliveries, total, page, pageSize });
});

// Queues a punch record for the worker's next poll: nextAttemptAt = now(),
// webhookHeld = false (clearing the hold is what lets a pre-webhook backlog
// record be explicitly sent on demand instead of automatically). Does NOT
// touch webhookAttempts - that's a running total across the record's whole
// life, not "attempts since the last manual retry," and the admin panel's
// Attempts column / delivery log both rely on it never going backwards.
// Once a record has hit webhookMaxAttempts it stays parked (see
// PARKED_NEXT_ATTEMPT in worker.ts) and this is the only way back into
// rotation - because the count isn't reset, one manual retry produces
// exactly one more attempt (attemptNumber is already >= max, so a failure
// re-parks it immediately) rather than re-arming several more automatic
// backoff retries.
async function resetForRetry(ids: string[]) {
  await prisma.punchRecord.updateMany({
    where: { id: { in: ids } },
    data: { nextAttemptAt: new Date(), webhookHeld: false },
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

  const scope = resolveCompanyScope(req, undefined);
  const visibleIds = scope.all
    ? parsed.data.ids
    : (
        await prisma.punchRecord.findMany({
          where: { id: { in: parsed.data.ids }, device: { companyId: scope.companyId } },
          select: { id: true },
        })
      ).map((r) => r.id);

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
