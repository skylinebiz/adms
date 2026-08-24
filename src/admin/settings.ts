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

const updateSchema = z.object({
  dataRetentionDays: z.coerce.number().int().min(MIN_DATA_RETENTION_DAYS).max(MAX_DATA_RETENTION_DAYS),
});

settingsRouter.patch("/", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  await getOrCreatePlatformSettings(prisma);
  const settings = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { dataRetentionDays: parsed.data.dataRetentionDays },
  });
  res.json({ settings });
});
