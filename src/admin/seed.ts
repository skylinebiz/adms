import bcrypt from "bcryptjs";
import { prisma } from "../db/client";
import { config } from "../config";
import { appLogger as logger } from "../logger";

// Idempotent: only seeds a super-admin the very first time the AdminUser
// table is empty. Safe to call on every server startup.
export async function seedBootstrapAdmin() {
  const existingCount = await prisma.adminUser.count();
  if (existingCount > 0) return;

  if (!config.adminBootstrapEmail || !config.adminBootstrapPassword) {
    logger.warn(
      "AdminUser table is empty but ADMIN_BOOTSTRAP_EMAIL/ADMIN_BOOTSTRAP_PASSWORD are not set - skipping seed. No admin can log in until one is created."
    );
    return;
  }

  const passwordHash = await bcrypt.hash(config.adminBootstrapPassword, 12);
  await prisma.adminUser.create({
    data: {
      email: config.adminBootstrapEmail,
      passwordHash,
      role: "SUPER_ADMIN",
      companyId: null,
      mustChangePassword: true,
    },
  });

  logger.info(
    { email: config.adminBootstrapEmail },
    "seeded bootstrap super-admin - change this password immediately after first login"
  );
}
