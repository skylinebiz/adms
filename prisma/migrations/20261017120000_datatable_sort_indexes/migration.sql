-- Indexes backing the sortable columns of the admin panel's server-side
-- datatables. Columns that aren't sortable (computed, free text, or
-- low-cardinality) deliberately get none.

-- CreateIndex
CREATE INDEX "companies_name_idx" ON "companies"("name");
CREATE INDEX "companies_createdAt_idx" ON "companies"("createdAt");

-- CreateIndex
CREATE INDEX "admin_users_role_idx" ON "admin_users"("role");
CREATE INDEX "admin_users_createdAt_idx" ON "admin_users"("createdAt");

-- CreateIndex
CREATE INDEX "devices_label_idx" ON "devices"("label");
CREATE INDEX "devices_lastSeenAt_idx" ON "devices"("lastSeenAt");
CREATE INDEX "devices_createdAt_idx" ON "devices"("createdAt");

-- CreateIndex
CREATE INDEX "punch_records_punchTime_idx" ON "punch_records"("punchTime");
CREATE INDEX "punch_records_punchTimeUtc_idx" ON "punch_records"("punchTimeUtc");
CREATE INDEX "punch_records_devicePin_idx" ON "punch_records"("devicePin");
CREATE INDEX "punch_records_webhookAttempts_idx" ON "punch_records"("webhookAttempts");

-- CreateIndex
CREATE INDEX "pending_devices_lastSeenAt_idx" ON "pending_devices"("lastSeenAt");
CREATE INDEX "pending_devices_pingCount_idx" ON "pending_devices"("pingCount");

-- CreateIndex
CREATE INDEX "device_raw_logs_deviceId_table_idx" ON "device_raw_logs"("deviceId", "table");
CREATE INDEX "device_raw_logs_deviceId_endpoint_idx" ON "device_raw_logs"("deviceId", "endpoint");

-- CreateIndex
CREATE INDEX "raw_request_logs_endpoint_idx" ON "raw_request_logs"("endpoint");
