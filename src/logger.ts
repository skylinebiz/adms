import pino from "pino";

export const appLogger = pino({
  name: "adms-app",
  level: process.env.LOG_LEVEL ?? "info",
});

// Dedicated logger for raw device traffic - kept separate from app logs so
// firmware-quirk debugging doesn't get lost in normal request noise.
export const deviceLogger = pino({
  name: "adms-device",
  level: process.env.DEVICE_LOG_LEVEL ?? "info",
});
