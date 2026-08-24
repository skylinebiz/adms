CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- Always exactly one row - inserted here so every reader can rely on it
-- existing rather than needing a defensive "create if missing" check.
INSERT INTO "platform_settings" ("id", "dataRetentionDays", "updatedAt")
VALUES ('singleton', 30, now());
