import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/db/client";
import { signAdminToken } from "../../src/admin/jwt";
import { config } from "../../src/config";

// Real Express app, real middleware stack (CORS/JSON/cookies/auth/every
// mounted router), real Postgres - the only thing not "real" here is that
// nothing binds a port; supertest talks to the app in-process. Every fixture
// this file creates is tagged with RUN_TAG so a single afterAll can find and
// delete exactly what a given test run created, nothing else, even if other
// suites or a developer's own manual testing left unrelated rows behind.
export const app = buildApp();

export const RUN_TAG = `sectest-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${RUN_TAG}-${seq}`;
}

export interface TestCompany {
  id: string;
  slug: string;
  name: string;
}

export async function createCompany(): Promise<TestCompany> {
  const slug = nextId("co").toLowerCase();
  const company = await prisma.company.create({ data: { name: slug, slug } });
  return company;
}

export type Role = "SUPER_ADMIN" | "COMPANY_ADMIN";

export interface TestAdmin {
  id: string;
  email: string;
  role: Role;
  companyId: string | null;
  cookie: string;
}

// Mints a real, correctly-signed session cookie the same way /login does,
// without paying bcrypt's cost on every fixture - login's own hashing path
// is covered separately in auth.spec.ts. The AdminUser row is still real,
// so any handler that re-reads it from the DB (e.g. GET /me) works too.
export async function createAdmin(role: Role, companyId: string | null): Promise<TestAdmin> {
  const email = `${nextId("admin")}@example.test`;
  const user = await prisma.adminUser.create({
    data: {
      email,
      passwordHash: "unused-in-these-tests",
      role,
      companyId: role === "SUPER_ADMIN" ? null : companyId,
    },
  });
  const token = signAdminToken({ sub: user.id, email: user.email, role, companyId: user.companyId });
  return { id: user.id, email: user.email, role, companyId: user.companyId, cookie: `${config.adminSessionCookieName}=${token}` };
}

export async function createDevice(companyId: string, overrides: Partial<{ serialNumber: string; deviceSecret: string; timezone: string }> = {}) {
  return prisma.device.create({
    data: {
      companyId,
      serialNumber: overrides.serialNumber ?? nextId("SN"),
      deviceSecret: overrides.deviceSecret ?? crypto.randomBytes(8).toString("hex"),
      timezone: overrides.timezone ?? "UTC",
    },
  });
}

export function forgeToken(payload: { sub: string; email: string; role: Role; companyId: string | null }, secret = "totally-wrong-secret"): string {
  // A token signed with a DIFFERENT secret than the server uses - simulates
  // an attacker who guessed/leaked a plausible-looking secret, or reused a
  // token from another deployment. Must be rejected by signature
  // verification alone, before any payload field is even looked at.
  return jwt.sign(payload, secret, { expiresIn: "1h" });
}

export async function cleanupAll(): Promise<void> {
  // Company delete cascades to AdminUser/Device/PendingDevice (and Device's
  // delete cascades further to PunchRecord/DeviceCommand/DeviceRawLog, and
  // PunchRecord's to WebhookDelivery) per the schema's onDelete: Cascade -
  // one delete clears the whole fixture tree. RawRequestLog/
  // UnregisteredDevicePing have no FK to Company (they're keyed by SN, not
  // company), so anything a test created there needs its own cleanup.
  await prisma.company.deleteMany({ where: { slug: { contains: RUN_TAG } } });
  await prisma.rawRequestLog.deleteMany({ where: { serialNumber: { contains: RUN_TAG } } });
  await prisma.unregisteredDevicePing.deleteMany({ where: { serialNumber: { contains: RUN_TAG } } });
  await prisma.pendingDevice.deleteMany({ where: { serialNumber: { contains: RUN_TAG } } });
}
