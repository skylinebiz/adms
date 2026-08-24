// Standalone webhook delivery worker. Runs independently of the ADMS/admin
// HTTP server (`server.ts`) - start it as its own process, e.g. `node dist/worker.js`.
// It is the *only* thing that ever calls out to a tenant's webhook URL; the
// ADMS ingestion routes only ever INSERT PunchRecord rows.
import { prisma } from "./db/client";
import { config } from "./config";
import { appLogger as logger } from "./logger";
import { dispatchPunchWebhook } from "./webhooks/dispatcher";
import { runRetentionSweep } from "./retentionSweep";
import { getOrCreatePlatformSettings } from "./utils/retention";

// Backoff schedule indexed by attempt number (1-based): 30s, 2m, 10m, 1h, 6h.
const BACKOFF_SCHEDULE_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

function computeBackoffMs(attemptNumber: number): number {
  const idx = Math.min(attemptNumber - 1, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[idx];
}

// Lease window applied to a claimed row's nextAttemptAt so a second worker
// instance (or a crashed-and-restarted one) won't double-send the same
// punch while this one is still mid-flight to the webhook endpoint.
const CLAIM_LEASE_MS = 60_000;

// Once retries are exhausted, park nextAttemptAt far in the future so the
// worker stops picking the row back up. The admin panel's "Retry now"
// action brings it back into rotation by resetting nextAttemptAt alone -
// webhookAttempts is deliberately left untouched (see resetForRetry in
// src/admin/punchRecords.ts), so a manual retry on an already-parked
// record produces exactly one more attempt before it re-parks, not a
// fresh run through the whole backoff schedule.
const PARKED_NEXT_ATTEMPT = new Date("2099-01-01T00:00:00Z");

async function claimBatch(batchSize: number): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT pr.id
      FROM punch_records pr
      JOIN devices d ON d.id = pr."deviceId"
      WHERE pr."webhookDelivered" = false
        AND pr."webhookHeld" = false
        AND pr."nextAttemptAt" <= now()
        AND d."webhookEnabled" = true
        AND d."webhookUrl" IS NOT NULL
      ORDER BY pr."nextAttemptAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE OF pr SKIP LOCKED
    `;

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    await tx.punchRecord.updateMany({
      where: { id: { in: ids } },
      data: { nextAttemptAt: new Date(Date.now() + CLAIM_LEASE_MS) },
    });

    return ids;
  });
}

async function processPunchRecord(id: string, webhookMaxAttempts: number, webhookTimeoutMs: number) {
  const punch = await prisma.punchRecord.findUnique({
    where: { id },
    include: { device: { include: { company: { select: { name: true } } } } },
  });
  if (!punch || !punch.device.webhookUrl) return;

  const result = await dispatchPunchWebhook(
    punch,
    punch.device,
    punch.device.company.name,
    webhookTimeoutMs
  );

  const attemptNumber = punch.webhookAttempts + 1;

  await prisma.$transaction([
    prisma.webhookDelivery.create({
      data: {
        punchRecordId: punch.id,
        url: punch.device.webhookUrl,
        attempt: attemptNumber,
        statusCode: result.statusCode,
        responseBody: result.responseBody,
        delivered: result.success,
        error: result.error,
        requestBody: result.requestBody,
        requestHeaders: JSON.stringify(result.requestHeaders),
      },
    }),
    prisma.punchRecord.update({
      where: { id: punch.id },
      data: result.success
        ? {
            webhookDelivered: true,
            webhookDeliveredAt: new Date(),
            webhookAttempts: attemptNumber,
            lastWebhookError: null,
          }
        : {
            webhookAttempts: attemptNumber,
            lastWebhookError: result.error,
            nextAttemptAt:
              attemptNumber >= webhookMaxAttempts
                ? PARKED_NEXT_ATTEMPT
                : new Date(Date.now() + computeBackoffMs(attemptNumber)),
          },
    }),
  ]);

  if (result.success) {
    logger.info({ punchId: punch.id, attempt: attemptNumber }, "webhook delivered");
  } else {
    logger.warn(
      { punchId: punch.id, attempt: attemptNumber, error: result.error, statusCode: result.statusCode },
      attemptNumber >= webhookMaxAttempts ? "webhook failed - retries exhausted" : "webhook failed - will retry"
    );
  }
}

// The actual deletion logic lives in ./retentionSweep (kept out of this
// file so it can be imported without pulling in this file's own
// `main().catch(...)` side effect below). This is just the "is a sweep
// actually due yet" gate, checked once per tick against a coarse
// timestamp rather than a separate setInterval, so it shares this
// single-flight loop and can never overlap a tick still in flight -
// there's no reason to re-check "anything expired yet" every few seconds
// when the unit is days.
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let nextRetentionSweepAt = 0; // due immediately on the very first tick

async function runRetentionSweepIfDue() {
  if (Date.now() < nextRetentionSweepAt) return;
  nextRetentionSweepAt = Date.now() + RETENTION_SWEEP_INTERVAL_MS;
  await runRetentionSweep();
}

let stopping = false;

async function tick() {
  try {
    // Fetched once per tick, not once per record - webhookMaxAttempts/
    // webhookTimeoutMs are now a live DB value (see PlatformSettings)
    // rather than a fixed-at-startup env var, but there's no need to
    // re-read it for every record in a batch of up to workerBatchSize.
    const settings = await getOrCreatePlatformSettings(prisma);
    const ids = await claimBatch(config.workerBatchSize);
    if (ids.length > 0) {
      logger.info({ count: ids.length }, "claimed punch records for webhook delivery");
    }
    for (const id of ids) {
      if (stopping) break;
      try {
        await processPunchRecord(id, settings.webhookMaxAttempts, settings.webhookTimeoutMs);
      } catch (err) {
        logger.error({ err, punchId: id }, "unexpected error processing punch record");
      }
    }
  } catch (err) {
    logger.error({ err }, "worker tick failed");
  }

  try {
    await runRetentionSweepIfDue();
  } catch (err) {
    logger.error({ err }, "data retention sweep failed");
  }
}

async function main() {
  // maxAttempts/timeout deliberately left out of this startup banner -
  // they're a live DB value now (PlatformSettings), not fixed for the
  // process's lifetime the way the env-var-backed fields below are, so a
  // value logged once at boot could go stale the moment an admin changes
  // it from the Settings page without a restart.
  logger.info(
    {
      pollIntervalMs: config.workerPollIntervalMs,
      batchSize: config.workerBatchSize,
    },
    "webhook worker starting"
  );

  while (!stopping) {
    await tick();
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, config.workerPollIntervalMs));
  }

  await prisma.$disconnect();
  logger.info("webhook worker stopped");
}

function shutdown(signal: string) {
  logger.info({ signal }, "shutdown signal received, finishing current tick");
  stopping = true;
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  logger.error({ err }, "worker crashed");
  process.exit(1);
});
