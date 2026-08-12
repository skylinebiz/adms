-- CreateTable
CREATE TABLE "device_raw_logs" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "table" TEXT,
    "query" TEXT,
    "headers" TEXT,
    "rawBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_raw_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_request_logs" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "query" TEXT,
    "headers" TEXT,
    "rawBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_raw_logs_deviceId_createdAt_idx" ON "device_raw_logs"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "raw_request_logs_createdAt_idx" ON "raw_request_logs"("createdAt");

-- CreateIndex
CREATE INDEX "raw_request_logs_serialNumber_idx" ON "raw_request_logs"("serialNumber");

-- AddForeignKey
ALTER TABLE "device_raw_logs" ADD CONSTRAINT "device_raw_logs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
