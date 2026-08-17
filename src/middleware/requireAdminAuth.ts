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
    // A company_admin with no companyId is a corrupted/invalid session -
    // resolveCompanyScope below relies on this never happening to safely
    // tell "super_admin, no filter requested" apart from "company_admin,
    // scope to mine." Reject it here rather than let every downstream
    // list/query endpoint have to guard against it individually.
    if (payload.role === "COMPANY_ADMIN" && !payload.companyId) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }
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

// A caller's company scope is one of exactly two shapes - never a bare
// `string | undefined`, which let "super_admin, no filter" and
// "company_admin, we don't know their company" collapse into the same
// falsy value and silently show a broken-state company_admin every
// company's data. `all: false` always carries a real companyId.
export type CompanyScope = { all: true } | { all: false; companyId: string };

// Resolves the company scope a request is allowed to act on:
// - super_admin: whatever companyId is requested, or unfiltered (all) if none given
// - company_admin: forced to their own companyId, regardless of what was requested
export function resolveCompanyScope(req: Request, requestedCompanyId?: string): CompanyScope {
  if (req.adminUser?.role === "SUPER_ADMIN") {
    return requestedCompanyId ? { all: false, companyId: requestedCompanyId } : { all: true };
  }
  // requireAdminAuth rejects any COMPANY_ADMIN session with a null
  // companyId before req.adminUser is ever set, so this is unreachable in
  // normal operation - the fallback exists only so a future caller that
  // somehow skips that guard fails closed (scoped to nothing) instead of
  // falling through to "all".
  const companyId = req.adminUser?.companyId;
  return { all: false, companyId: companyId ?? "__unscoped_company_admin__" };
}
