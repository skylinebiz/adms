import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { config } from "../config";
import { requireSuperAdmin, resolveCompanyScope } from "../middleware/requireAdminAuth";
import { dispatchWebhook, renderPunchWebhookBody } from "../webhooks/dispatcher";
import { renderHeaders, SAMPLE_TEMPLATE_VARS } from "../webhooks/template";
import { OPTIONS_LIMIT, paginationQuerySchema } from "../utils/pagination";

export const devicesRouter = Router();

// Nullable Json columns need an explicit sentinel to clear them: passing a
// bare JS `null` to Prisma for a Json field is rejected (ambiguous between
// "SQL NULL" and the JSON literal `null`). `undefined` still means "leave
// untouched" and passes through unchanged.
function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

// Headers are a flat string->string map (they're HTTP headers). The body
// template is arbitrary JSON - validated only for JSON-serializability.
const headersSchema = z.record(z.string()).nullable().optional();
const bodyTemplateSchema = z
  .unknown()
  .nullable()
  .optional()
  .refine(
    (v) => {
      if (v === null || v === undefined) return true;
      try {
        JSON.stringify(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Body template must be valid JSON" }
  );

function maskWebhookUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.length > 1 ? "/…" : ""}`;
  } catch {
    return url.length > 24 ? `${url.slice(0, 24)}…` : url;
  }
}

function toDeviceListItem(device: {
  id: string;
  companyId: string;
  serialNumber: string;
  label: string | null;
  status: string;
  lastSeenAt: Date | null;
  webhookUrl: string | null;
  webhookEnabled: boolean;
  createdAt: Date;
}) {
  return { ...device, webhookUrlMasked: maskWebhookUrl(device.webhookUrl), webhookUrl: undefined };
}

// NOTE: unregistered-pings/options must be registered before the /:id param
// route so those path segments aren't swallowed as an :id.
//
// Unregistered SNs are grouped (distinct SN, not one row per ping), and
// filtered against the registered-device set before pagination is applied,
// so page counts stay correct. The distinct-SN set is fetched in full and
// paginated in memory - bounded by the number of *distinct* unknown serial
// numbers ever seen (not total ping volume), which is a modest dataset even
// under sustained junk traffic.
devicesRouter.get("/unregistered-pings", async (req, res) => {
  if (req.adminUser!.role !== "SUPER_ADMIN") {
    // Unregistered pings have no company yet - only super_admin can triage them.
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsedQuery = paginationQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid query", details: parsedQuery.error.flatten() });
    return;
  }
  const { page, pageSize } = parsedQuery.data;

  const registered = new Set(
    (await prisma.device.findMany({ select: { serialNumber: true } })).map((d) => d.serialNumber)
  );

  const grouped = await prisma.unregisteredDevicePing.groupBy({
    by: ["serialNumber"],
    _max: { createdAt: true },
    _count: { _all: true },
    orderBy: { _max: { createdAt: "desc" } },
  });

  const allPings = grouped
    .filter((p) => !registered.has(p.serialNumber))
    .map((p) => ({
      serialNumber: p.serialNumber,
      pingCount: p._count._all,
      lastSeenAt: p._max.createdAt,
    }));

  const total = allPings.length;
  const pings = allPings.slice((page - 1) * pageSize, page * pageSize);

  res.json({ pings, total, page, pageSize });
});

// Deletes every logged ping for a serial number, clearing it from the
// unregistered-devices triage list. super_admin only, matching the view.
devicesRouter.delete("/unregistered-pings/:serialNumber", requireSuperAdmin, async (req, res) => {
  const result = await prisma.unregisteredDevicePing.deleteMany({
    where: { serialNumber: req.params.serialNumber },
  });
  if (result.count === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true, deleted: result.count });
});

const unregisteredBulkDeleteSchema = z.object({ serialNumbers: z.array(z.string()).min(1).max(500) });

devicesRouter.post("/unregistered-pings/delete-bulk", requireSuperAdmin, async (req, res) => {
  const parsed = unregisteredBulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const result = await prisma.unregisteredDevicePing.deleteMany({
    where: { serialNumber: { in: parsed.data.serialNumbers } },
  });
  res.json({ ok: true, deleted: result.count });
});

// Lightweight, capped (not fully paginated) list for populating <select>
// dropdowns, where you want "all devices" rather than one page of them.
devicesRouter.get("/options", async (req, res) => {
  const companyId = resolveCompanyScope(req, req.query.companyId as string | undefined);
  const devices = await prisma.device.findMany({
    where: companyId ? { companyId } : undefined,
    orderBy: [{ label: "asc" }, { serialNumber: "asc" }],
    take: OPTIONS_LIMIT,
    select: { id: true, serialNumber: true, label: true, companyId: true },
  });
  res.json({ devices });
});

const claimSchema = z.object({
  serialNumber: z.string().min(1),
  companyId: z.string().min(1),
  label: z.string().optional(),
});

devicesRouter.post("/claim", async (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  if (req.adminUser!.role !== "SUPER_ADMIN" && req.adminUser!.companyId !== parsed.data.companyId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const device = await prisma.device
    .create({
      data: {
        serialNumber: parsed.data.serialNumber,
        companyId: parsed.data.companyId,
        label: parsed.data.label,
      },
    })
    .catch((err) => {
      if (err?.code === "P2002") return "conflict" as const;
      throw err;
    });

  if (device === "conflict") {
    res.status(409).json({ error: "A device with this serial number is already registered" });
    return;
  }
  res.status(201).json({ device: toDeviceListItem(device) });
});

devicesRouter.get("/", async (req, res) => {
  const parsedQuery = paginationQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid query", details: parsedQuery.error.flatten() });
    return;
  }
  const { page, pageSize } = parsedQuery.data;

  const companyId = resolveCompanyScope(req, req.query.companyId as string | undefined);
  const where = companyId ? { companyId } : undefined;

  const [devices, total] = await Promise.all([
    prisma.device.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { company: { select: { id: true, name: true } } },
    }),
    prisma.device.count({ where }),
  ]);
  res.json({ devices: devices.map((d) => ({ ...toDeviceListItem(d), company: d.company })), total, page, pageSize });
});

devicesRouter.get("/:id", async (req, res) => {
  const device = await prisma.device.findUnique({
    where: { id: req.params.id },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!device) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.adminUser!.role !== "SUPER_ADMIN" && req.adminUser!.companyId !== device.companyId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // Full (unmasked) webhook URL is fine here - this is the single-device edit view.
  res.json({ device });
});

const createSchema = z.object({
  companyId: z.string().min(1),
  serialNumber: z.string().min(1),
  label: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  webhookEnabled: z.boolean().optional(),
  webhookHeaders: headersSchema,
  webhookBodyTemplate: bodyTemplateSchema,
});

devicesRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  if (req.adminUser!.role !== "SUPER_ADMIN" && req.adminUser!.companyId !== parsed.data.companyId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const device = await prisma.device
    .create({
      data: {
        ...parsed.data,
        webhookHeaders: toJsonInput(parsed.data.webhookHeaders),
        webhookBodyTemplate: toJsonInput(parsed.data.webhookBodyTemplate),
        webhookSecret: parsed.data.webhookUrl ? crypto.randomBytes(24).toString("hex") : null,
      },
    })
    .catch((err) => {
      if (err?.code === "P2002") return "conflict" as const;
      throw err;
    });

  if (device === "conflict") {
    res.status(409).json({ error: "A device with this serial number is already registered" });
    return;
  }
  res.status(201).json({ device });
});

const updateSchema = z.object({
  label: z.string().optional(),
  webhookUrl: z.string().url().nullable().optional(),
  webhookEnabled: z.boolean().optional(),
  webhookHeaders: headersSchema,
  webhookBodyTemplate: bodyTemplateSchema,
  regenerateSecret: z.boolean().optional(),
});

devicesRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.adminUser!.role !== "SUPER_ADMIN" && req.adminUser!.companyId !== existing.companyId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { regenerateSecret, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if ("webhookHeaders" in rest) data.webhookHeaders = toJsonInput(rest.webhookHeaders);
  if ("webhookBodyTemplate" in rest) data.webhookBodyTemplate = toJsonInput(rest.webhookBodyTemplate);
  if (regenerateSecret || (rest.webhookUrl && !existing.webhookSecret)) {
    data.webhookSecret = crypto.randomBytes(24).toString("hex");
  }

  const device = await prisma.device.update({ where: { id: req.params.id }, data });
  res.json({ device });
});

// Sends a live test webhook using the device's saved config, with optional
// per-field overrides so a user can try out changes before saving them.
// Uses realistic sample data (not a real punch) and never persists a
// WebhookDelivery/PunchRecord row - it's purely a connectivity/shape check.
const testWebhookSchema = z.object({
  url: z.string().url().optional(),
  secret: z.string().nullable().optional(),
  headers: z.record(z.string()).nullable().optional(),
  bodyTemplate: bodyTemplateSchema,
});

devicesRouter.post("/:id/test-webhook", async (req, res) => {
  const device = await prisma.device.findUnique({
    where: { id: req.params.id },
    include: { company: { select: { name: true } } },
  });
  if (!device) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.adminUser!.role !== "SUPER_ADMIN" && req.adminUser!.companyId !== device.companyId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = testWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const url = parsed.data.url ?? device.webhookUrl;
  if (!url) {
    res.status(400).json({ error: "No webhook URL configured or provided" });
    return;
  }
  const secret = parsed.data.secret !== undefined ? parsed.data.secret : device.webhookSecret;
  const headers = parsed.data.headers !== undefined ? parsed.data.headers : (device.webhookHeaders as Record<string, string> | null);
  const bodyTemplate = parsed.data.bodyTemplate !== undefined ? parsed.data.bodyTemplate : device.webhookBodyTemplate;

  const vars = {
    ...SAMPLE_TEMPLATE_VARS,
    device_id: device.id,
    device_serial: device.serialNumber,
    company_id: device.companyId,
    company_name: device.company.name,
  };

  const body = renderPunchWebhookBody(bodyTemplate, vars);
  const renderedHeaders = renderHeaders(headers, vars);
  const result = await dispatchWebhook(url, secret, body, config.webhookTimeoutMs, renderedHeaders);

  res.json({ sentBody: body, sentHeaders: renderedHeaders, result });
});

// Raw Data Dump: whatever non-ATTLOG payloads this device has pushed
// (OPERLOG, USERINFO, FINGERTMP, FACE, or anything else a firmware variant
// sends), for debugging what a device is actually sending. Optional
// ?table= filter narrows to one table name.
const rawLogsQuerySchema = paginationQuerySchema.extend({
  table: z.string().optional(),
});

devicesRouter.get("/:id/raw-logs", async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.adminUser!.role !== "SUPER_ADMIN" && req.adminUser!.companyId !== device.companyId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsedQuery = rawLogsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid query", details: parsedQuery.error.flatten() });
    return;
  }
  const { page, pageSize, table } = parsedQuery.data;
  const where = { deviceId: device.id, ...(table ? { table } : {}) };

  const [logs, total] = await Promise.all([
    prisma.deviceRawLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.deviceRawLog.count({ where }),
  ]);

  res.json({ logs, total, page, pageSize });
});

// Deletion is restricted to super_admin, same reasoning as punch records -
// destructive to debug/audit history, so no company_admin self-service.
devicesRouter.delete("/:id/raw-logs/:logId", requireSuperAdmin, async (req, res) => {
  const log = await prisma.deviceRawLog.findUnique({ where: { id: req.params.logId } });
  if (!log || log.deviceId !== req.params.id) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await prisma.deviceRawLog.delete({ where: { id: log.id } });
  res.json({ ok: true });
});

const rawLogBulkDeleteSchema = z.object({ ids: z.array(z.string()).min(1).max(500) });

devicesRouter.post("/:id/raw-logs/delete-bulk", requireSuperAdmin, async (req, res) => {
  const parsed = rawLogBulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  // Scoped to deviceId as well as id, so ids from another device can never
  // slip through even if included in the request.
  const result = await prisma.deviceRawLog.deleteMany({
    where: { id: { in: parsed.data.ids }, deviceId: req.params.id },
  });
  res.json({ ok: true, deleted: result.count });
});

devicesRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.adminUser!.role !== "SUPER_ADMIN" && req.adminUser!.companyId !== existing.companyId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await prisma.device.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
