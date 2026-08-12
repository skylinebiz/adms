import crypto from "node:crypto";
import type { Device, PunchRecord } from "@prisma/client";
import { PunchTemplateVars, renderBodyTemplate, renderHeaders } from "./template";

export interface PunchWebhookPayload {
  event: "punch.created";
  company_id: string;
  device_id: string;
  device_serial: string;
  pin: string;
  punch_time: string;
  status: number;
  verify_mode: number;
  work_code: string | null;
  received_at: string;
}

export function buildTemplateVars(
  punch: PunchRecord,
  device: Pick<Device, "id" | "companyId" | "serialNumber">,
  companyName: string
): PunchTemplateVars {
  return {
    pin: punch.devicePin,
    punch_time: punch.punchTime.toISOString(),
    punch_time_unix: Math.floor(punch.punchTime.getTime() / 1000),
    status: punch.status,
    verify_mode: punch.verifyMode,
    work_code: punch.workCode,
    device_id: device.id,
    device_serial: device.serialNumber,
    company_id: device.companyId,
    company_name: companyName,
    received_at: punch.receivedAt.toISOString(),
  };
}

// Default payload shape used when a device has no custom webhookBodyTemplate set.
export function buildDefaultPayload(vars: PunchTemplateVars): PunchWebhookPayload {
  return {
    event: "punch.created",
    company_id: vars.company_id,
    device_id: vars.device_id,
    device_serial: vars.device_serial,
    pin: vars.pin,
    punch_time: vars.punch_time,
    status: vars.status,
    verify_mode: vars.verify_mode,
    work_code: vars.work_code,
    received_at: vars.received_at,
  };
}

// Renders the final JSON body for a punch: the custom template if one is
// configured, otherwise the default punch.created shape.
export function renderPunchWebhookBody(bodyTemplate: unknown | null | undefined, vars: PunchTemplateVars): unknown {
  if (bodyTemplate === null || bodyTemplate === undefined) {
    return buildDefaultPayload(vars);
  }
  return renderBodyTemplate(bodyTemplate, vars);
}

export function signPayload(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

export interface WebhookDispatchResult {
  success: boolean;
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
}

const MAX_STORED_RESPONSE_BODY = 5000;

// Signs + POSTs a single webhook body and reports success/failure. This
// module is called only by the worker process (and the admin test-webhook
// endpoint) - the ADMS ingestion routes must never import it, so a slow or
// unreachable webhook can never delay the "OK" a device is waiting on.
export async function dispatchWebhook(
  url: string,
  secret: string | null,
  body: unknown,
  timeoutMs: number,
  extraHeaders?: Record<string, string> | null
): Promise<WebhookDispatchResult> {
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extraHeaders ?? {}),
  };
  if (secret) {
    headers["X-Webhook-Signature"] = `sha256=${signPayload(rawBody, secret)}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: rawBody,
      signal: controller.signal,
    });

    const responseBody = (await response.text().catch(() => "")).slice(0, MAX_STORED_RESPONSE_BODY);

    return {
      success: response.ok,
      statusCode: response.status,
      responseBody,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      success: false,
      statusCode: null,
      responseBody: null,
      error: isAbort ? `timed out after ${timeoutMs}ms` : err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Renders a punch's webhook body + headers using the device's configured
// template/headers (or the default shape) and dispatches it.
export async function dispatchPunchWebhook(
  punch: PunchRecord,
  device: Pick<Device, "id" | "companyId" | "serialNumber" | "webhookUrl" | "webhookSecret" | "webhookHeaders" | "webhookBodyTemplate">,
  companyName: string,
  timeoutMs: number
): Promise<WebhookDispatchResult> {
  if (!device.webhookUrl) {
    return { success: false, statusCode: null, responseBody: null, error: "no webhook URL configured" };
  }
  const vars = buildTemplateVars(punch, device, companyName);
  const body = renderPunchWebhookBody(device.webhookBodyTemplate, vars);
  const headers = renderHeaders((device.webhookHeaders as Record<string, string> | null) ?? null, vars);
  return dispatchWebhook(device.webhookUrl, device.webhookSecret, body, timeoutMs, headers);
}
