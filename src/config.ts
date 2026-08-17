import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", "dev-only-insecure-secret-change-me"),
  adminSessionCookieName: process.env.ADMIN_SESSION_COOKIE_NAME ?? "adms_admin",
  adminBootstrapEmail: process.env.ADMIN_BOOTSTRAP_EMAIL,
  adminBootstrapPassword: process.env.ADMIN_BOOTSTRAP_PASSWORD,
  // Anything bytes()-parseable (see the body-parser/bytes package): "10mb",
  // "5242880", etc. FACE/FINGERTMP/photo payloads on some firmware are the
  // realistic reason to ever raise this - each in-flight request buffers
  // its whole body in memory, so raise it deliberately, not reflexively.
  admsMaxBodySize: process.env.ADMS_MAX_BODY_SIZE ?? "10mb",
  // A device has no "going offline" signal of its own (no disconnect
  // notice, no last-will) - a push device just stops calling in. A normal
  // device polls/heartbeats every few seconds up to a couple of minutes
  // (GET cdata handshake, GET getrequest), so silence past this many
  // milliseconds means it's missed several cycles in a row, not just one
  // delayed request. See computeDeviceStatus in src/utils/deviceStatus.ts.
  deviceOfflineThresholdMs: Number(process.env.DEVICE_OFFLINE_THRESHOLD_MS ?? 5 * 60 * 1000),
  webhookMaxAttempts: Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 5),
  webhookTimeoutMs: Number(process.env.WEBHOOK_TIMEOUT_MS ?? 8000),
  workerPollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 3000),
  workerBatchSize: Number(process.env.WORKER_BATCH_SIZE ?? 50),
};
