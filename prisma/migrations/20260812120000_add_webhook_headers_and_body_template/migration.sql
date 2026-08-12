-- Custom headers and custom JSON body template per device webhook config.
ALTER TABLE "devices" ADD COLUMN "webhookHeaders" JSONB;
ALTER TABLE "devices" ADD COLUMN "webhookBodyTemplate" JSONB;
