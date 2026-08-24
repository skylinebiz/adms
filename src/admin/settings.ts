import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { requireSuperAdmin } from "../middleware/requireAdminAuth";
import { MAX_DATA_RETENTION_DAYS, MIN_DATA_RETENTION_DAYS, getOrCreatePlatformSettings } from "../utils/retention";

// Platform-wide (not per-company) settings - super_admin only, both to
// read and to change. There is exactly one row, always at this fixed id.
export const settingsRouter = Router();
settingsRouter.use(requireSuperAdmin);

settingsRouter.get("/", async (_req, res) => {
  const settings = await getOrCreatePlatformSettings(prisma);
  res.json({ settings });
});

// Every field optional - a genuine partial update (the admin UI saves
// "Data retention" and "Webhook delivery" as two independent forms), not
// a full-replace. At least one field must actually be present, though -
// an empty body is almost certainly a client bug, not an intentional no-op.
const updateSchema = z
  .object({
    dataRetentionDays: z.coerce.number().int().min(MIN_DATA_RETENTION_DAYS).max(MAX_DATA_RETENTION_DAYS).optional(),
    // Bounded well above the 5-entry backoff schedule (computeBackoffMs in
    // worker.ts clamps to its last entry for any attempt beyond that, so a
    // higher value just means more 6h-spaced retries, not a crash) - the
    // ceiling exists only to catch a fat-fingered extra zero.
    webhookMaxAttempts: z.coerce.number().int().min(1).max(50).optional(),
    // 1s floor guards against a value so low every attempt would time out
    // before a normal HTTP round-trip could ever complete; 2min ceiling
    // guards against one slow endpoint stalling a whole worker batch.
    webhookTimeoutMs: z.coerce.number().int().min(1000).max(120_000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No settings provided" });

settingsRouter.patch("/", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  await getOrCreatePlatformSettings(prisma);
  const settings = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: parsed.data,
  });
  res.json({ settings });
});
