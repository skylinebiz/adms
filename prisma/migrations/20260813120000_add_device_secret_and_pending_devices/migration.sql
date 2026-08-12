-- Path secret devices authenticate with (not globally unique - lookup is
-- always by SN, this only validates the request against that SN).
ALTER TABLE "devices" ADD COLUMN "deviceSecret" TEXT;

-- CreateTable
CREATE TABLE "pending_devices" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "secret" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pingCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pending_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_devices_serialNumber_key" ON "pending_devices"("serialNumber");
