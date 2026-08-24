ALTER TABLE "platform_settings" ADD COLUMN "webhookMaxAttempts" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "platform_settings" ADD COLUMN "webhookTimeoutMs" INTEGER NOT NULL DEFAULT 8000;
