import { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { verifyAdminToken } from "../admin/jwt";

// Auth middleware for /api/admin/* only. Must never be mounted ahead of
// /iclock/* - device firmware cannot authenticate.
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[config.adminSessionCookieName];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const payload = verifyAdminToken(token);
    req.adminUser = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      companyId: payload.companyId,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.adminUser?.role !== "SUPER_ADMIN") {
    res.status(403).json({ error: "Super admin access required" });
    return;
  }
  next();
}

// Resolves the company scope a request is allowed to act on:
// - super_admin: whatever companyId is requested (or undefined = all)
// - company_admin: forced to their own companyId, regardless of what was requested
export function resolveCompanyScope(req: Request, requestedCompanyId?: string): string | undefined {
  if (req.adminUser?.role === "SUPER_ADMIN") {
    return requestedCompanyId;
  }
  return req.adminUser?.companyId ?? undefined;
}
