import type { PrismaClient } from "@prisma/client";

// Shared between the admin settings API (validates what an operator can
// set) and the worker's retention sweep (computes what "older than N days"
// actually means) - kept in one place so the two can never drift apart.

export const DEFAULT_DATA_RETENTION_DAYS = 30;
// A floor of 1, not 0: a fat-fingered 0 would mean "delete everything,
// including data from moments ago" on the very next sweep - requiring at
// least one full day is a cheap guard against that.
export const MIN_DATA_RETENTION_DAYS = 1;
// A ceiling exists only to catch an obvious mistake (an extra zero or two)
// before it's saved, not because 10 years is a real recommended value.
export const MAX_DATA_RETENTION_DAYS = 3650;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeRetentionCutoff(retentionDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}

const PLATFORM_SETTINGS_ID = "singleton";

// Self-healing: the migration that introduced this table inserts the one
// row it ever has, but upserting here means a manually-deleted row still
// resolves to the documented default instead of every reader (the admin
// settings API, the worker's retention sweep) having to duplicate a
// "missing row -> assume default" fallback separately.
export async function getOrCreatePlatformSettings(prisma: PrismaClient) {
  return prisma.platformSettings.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    update: {},
    create: { id: PLATFORM_SETTINGS_ID },
  });
}
