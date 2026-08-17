const BASE = "/api/admin";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? res.statusText, body?.details);
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined });
const patch = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

function buildQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][]
  ).toString();
  return q ? `?${q}` : "";
}

export interface PageParams {
  page?: number;
  pageSize?: number;
}

// Public - no session required, so the login/signup screens can show it too.
export function getVersion() {
  return get<{ version: string }>("/version");
}

export interface Paginated<T> {
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  role: "SUPER_ADMIN" | "COMPANY_ADMIN";
  companyId: string | null;
  mustChangePassword: boolean;
  createdAt?: string;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  _count?: { devices: number; adminUsers: number };
}

export interface CompanyOption {
  id: string;
  name: string;
  slug: string;
}

export interface Device {
  id: string;
  companyId: string;
  serialNumber: string;
  label: string | null;
  status: "UNKNOWN" | "ONLINE" | "OFFLINE";
  lastSeenAt: string | null;
  webhookUrl?: string | null;
  webhookUrlMasked?: string | null;
  webhookSecret?: string | null;
  webhookEnabled: boolean;
  webhookHeaders?: Record<string, string> | null;
  webhookBodyTemplate?: unknown | null;
  // Absent in list responses (masked out); when present (detail view),
  // always a real string - mandatory on every device now.
  deviceSecret?: string;
  // Mandatory on every device now - always a real IANA zone name.
  timezone: string;
  createdAt: string;
  company?: { id: string; name: string; slug: string };
}

export interface DeviceOption {
  id: string;
  serialNumber: string;
  label: string | null;
  companyId: string;
}

export interface DeviceCommandLog {
  id: string;
  command: string;
  status: "PENDING" | "SENT" | "ACKED" | "FAILED";
  response: string | null;
  createdAt: string;
  sentAt: string | null;
  ackedAt: string | null;
}

export interface DeviceRawLog {
  id: string;
  deviceId: string;
  endpoint: string;
  method: string;
  table: string | null;
  query: string | null;
  headers: string | null;
  rawBody: string | null;
  createdAt: string;
}

export interface RawRequestLog {
  id: string;
  serialNumber: string | null;
  endpoint: string;
  method: string;
  query: string | null;
  headers: string | null;
  rawBody: string | null;
  createdAt: string;
}

export interface TestWebhookResult {
  sentBody: unknown;
  sentHeaders: Record<string, string>;
  result: {
    success: boolean;
    statusCode: number | null;
    responseBody: string | null;
    error: string | null;
  };
}

export interface PunchRecord {
  id: string;
  deviceId: string;
  devicePin: string;
  punchTime: string;
  punchTimeUtc: string | null;
  status: number;
  verifyMode: number;
  workCode: string | null;
  rawLine: string;
  receivedAt: string;
  webhookDelivered: boolean;
  webhookAttempts: number;
  nextAttemptAt: string;
  lastWebhookError: string | null;
  webhookDeliveredAt: string | null;
  webhookHeld: boolean;
  webhookStatus: "delivered" | "pending" | "failed" | "not_applicable";
  device?: { id: string; serialNumber: string; label: string | null; companyId: string };
}

export interface WebhookDelivery {
  id: string;
  punchRecordId: string;
  url: string;
  attempt: number;
  statusCode: number | null;
  responseBody: string | null;
  delivered: boolean;
  error: string | null;
  createdAt: string;
}

export const api = {
  login: (email: string, password: string) => post<{ user: AdminUserSummary }>("/auth/login", { email, password }),
  signup: (data: { companyName: string; slug: string; email: string; password: string }) =>
    post<{ user: AdminUserSummary }>("/auth/signup", data),
  logout: () => post<{ ok: true }>("/auth/logout"),
  me: () => get<{ user: AdminUserSummary }>("/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    patch<{ ok: true }>("/auth/me/password", { currentPassword, newPassword }),

  listCompanies: (params: PageParams = {}) =>
    get<{ companies: Company[] } & Paginated<Company>>(
      `/companies${buildQuery({ page: params.page, pageSize: params.pageSize })}`
    ),
  listCompanyOptions: () => get<{ companies: CompanyOption[] }>("/companies/options"),
  createCompany: (data: { name: string; slug: string }) => post<{ company: Company }>("/companies", data),
  // slug is fixed at creation - changing it would orphan every device
  // already pointed at that URL - so only `name` can be patched.
  updateCompany: (id: string, data: { name: string }) => patch<{ company: Company }>(`/companies/${id}`, data),
  deleteCompany: (id: string) => del<{ ok: true }>(`/companies/${id}`),

  listAdminUsers: (params: { companyId?: string } & PageParams = {}) =>
    get<{ adminUsers: AdminUserSummary[] } & Paginated<AdminUserSummary>>(
      `/admin-users${buildQuery({ companyId: params.companyId, page: params.page, pageSize: params.pageSize })}`
    ),
  createAdminUser: (data: { email: string; password: string; role: string; companyId: string | null }) =>
    post<{ adminUser: AdminUserSummary }>("/admin-users", data),
  updateAdminUser: (id: string, data: Partial<{ email: string; role: string; companyId: string | null }>) =>
    patch<{ adminUser: AdminUserSummary }>(`/admin-users/${id}`, data),
  deleteAdminUser: (id: string) => del<{ ok: true }>(`/admin-users/${id}`),
  resetAdminUserPassword: (id: string, newPassword: string) =>
    post<{ ok: true }>(`/admin-users/${id}/reset-password`, { newPassword }),

  listDevices: (params: { companyId?: string } & PageParams = {}) =>
    get<{ devices: Device[] } & Paginated<Device>>(
      `/devices${buildQuery({ companyId: params.companyId, page: params.page, pageSize: params.pageSize })}`
    ),
  listDeviceOptions: (companyId?: string) =>
    get<{ devices: DeviceOption[] }>(`/devices/options${buildQuery({ companyId })}`),
  getDevice: (id: string) => get<{ device: Device }>(`/devices/${id}`),
  createDevice: (data: {
    companyId: string;
    serialNumber: string;
    label?: string;
    deviceSecret: string;
    timezone: string;
    webhookUrl?: string;
    webhookEnabled?: boolean;
    webhookHeaders?: Record<string, string> | null;
    webhookBodyTemplate?: unknown | null;
  }) => post<{ device: Device }>("/devices", data),
  updateDevice: (
    id: string,
    data: Partial<{
      label: string;
      deviceSecret: string;
      timezone: string;
      webhookUrl: string | null;
      webhookEnabled: boolean;
      webhookHeaders: Record<string, string> | null;
      webhookBodyTemplate: unknown | null;
      regenerateSecret: boolean;
    }>
  ) => patch<{ device: Device }>(`/devices/${id}`, data),
  deleteDevice: (id: string) => del<{ ok: true }>(`/devices/${id}`),
  testWebhook: (
    id: string,
    overrides: {
      url?: string;
      secret?: string | null;
      headers?: Record<string, string> | null;
      bodyTemplate?: unknown | null;
    }
  ) => post<TestWebhookResult>(`/devices/${id}/test-webhook`, overrides),
  listUnregisteredPings: (params: PageParams = {}) =>
    get<
      {
        pings: {
          serialNumber: string;
          pingCount: number;
          lastSeenAt: string;
          secret: string | null;
          companyId: string | null;
          company: { id: string; name: string; slug: string } | null;
        }[];
      } & Paginated<unknown>
    >(`/devices/unregistered-pings${buildQuery({ page: params.page, pageSize: params.pageSize })}`),
  claimDevice: (data: { serialNumber: string; companyId: string; label?: string; timezone: string }) =>
    post<{ device: Device }>("/devices/claim", data),
  deleteUnregisteredPing: (serialNumber: string) =>
    del<{ ok: true; deleted: number }>(`/devices/unregistered-pings/${encodeURIComponent(serialNumber)}`),
  deleteUnregisteredPingsBulk: (serialNumbers: string[]) =>
    post<{ ok: true; deleted: number }>("/devices/unregistered-pings/delete-bulk", { serialNumbers }),
  getDeviceRawLogs: (deviceId: string, params: { table?: string } & PageParams = {}) =>
    get<{ logs: DeviceRawLog[] } & Paginated<DeviceRawLog>>(
      `/devices/${deviceId}/raw-logs${buildQuery({ table: params.table, page: params.page, pageSize: params.pageSize })}`
    ),
  sendDeviceCommand: (deviceId: string, command: string) =>
    post<{ command: DeviceCommandLog }>(`/devices/${deviceId}/commands`, { command }),
  listDeviceCommands: (deviceId: string) => get<{ commands: DeviceCommandLog[] }>(`/devices/${deviceId}/commands`),

  listRawRequests: (params: { serialNumber?: string; endpoint?: string } & PageParams = {}) =>
    get<{ requests: RawRequestLog[] } & Paginated<RawRequestLog>>(
      `/raw-requests${buildQuery({
        serialNumber: params.serialNumber,
        endpoint: params.endpoint,
        page: params.page,
        pageSize: params.pageSize,
      })}`
    ),

  listPunchRecords: (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return get<{ records: PunchRecord[]; total: number; page: number; pageSize: number }>(
      `/punch-records${q ? `?${q}` : ""}`
    );
  },
  listFailedPunchRecords: (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return get<{ records: PunchRecord[]; total: number; page: number; pageSize: number }>(
      `/punch-records/failed${q ? `?${q}` : ""}`
    );
  },
  getDeliveries: (punchRecordId: string, params: PageParams = {}) =>
    get<{ punchRecord: PunchRecord; deliveries: WebhookDelivery[] } & Paginated<WebhookDelivery>>(
      `/punch-records/${punchRecordId}/deliveries${buildQuery({ page: params.page, pageSize: params.pageSize })}`
    ),
  retryPunchRecord: (id: string) => post<{ ok: true }>(`/punch-records/${id}/retry`),
  retryBulk: (ids: string[]) => post<{ ok: true; retried: number }>("/punch-records/retry-bulk", { ids }),
  deletePunchRecord: (id: string) => del<{ ok: true }>(`/punch-records/${id}`),
  deletePunchRecordsBulk: (ids: string[]) =>
    post<{ ok: true; deleted: number }>("/punch-records/delete-bulk", { ids }),

  deleteDeviceRawLog: (deviceId: string, logId: string) =>
    del<{ ok: true }>(`/devices/${deviceId}/raw-logs/${logId}`),
  deleteDeviceRawLogsBulk: (deviceId: string, ids: string[]) =>
    post<{ ok: true; deleted: number }>(`/devices/${deviceId}/raw-logs/delete-bulk`, { ids }),

  deleteRawRequest: (id: string) => del<{ ok: true }>(`/raw-requests/${id}`),
  deleteRawRequestsBulk: (ids: string[]) =>
    post<{ ok: true; deleted: number }>("/raw-requests/delete-bulk", { ids }),
};
