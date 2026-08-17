import { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { handleCdataGet, handleCdataPost } from "./cdata";
import { handleGetRequest } from "./getrequest";
import { handleDeviceCmd } from "./devicecmd";
import { handleTest } from "./test";
import { logRawRequest } from "./rawLog";
import { RESERVED_SLUG_VALUES } from "../utils/slug";

// A company slug can never be one of these, even though the
// `/:companySlug/:secret/iclock` mount would otherwise accept any string
// here - belt-and-suspenders on top of the fact that a real Company can
// never be created with a reserved slug in the first place (enforced by
// slugSchema at signup/company-create time), and on top of route
// registration order (which already makes real collisions with /admin,
// /api/admin, /health unreachable, since none of those have "iclock" as
// their third path segment). Stripping it here just means the request
// falls back to "unresolved slug" behavior (null companyId on any
// PendingDevice it creates) rather than accidentally scoping to a fake
// company.
export function clearReservedCompanySlug(req: Request, _res: Response, next: NextFunction) {
  if (req.params.companySlug && RESERVED_SLUG_VALUES.has(req.params.companySlug.toLowerCase())) {
    delete req.params.companySlug;
  }
  next();
}

// This entire router is intentionally unauthenticated and CSRF-exempt:
// ZKTeco firmware cannot do logins, custom headers, or CSRF tokens. Do not
// mount any auth/session/CSRF middleware ahead of this router.
//
// mergeParams: true is required so req.params.companySlug and
// req.params.secret (captured by the parent /:companySlug/:secret/iclock
// mount in server.ts) are actually visible to the routes below - without
// it, Express resets req.params for a mounted Router() and both would
// silently look like they were never sent.
export const admsRouter = Router({ mergeParams: true });

// ZKTeco payloads are plain tab-separated text, not JSON/urlencoded - parse
// the raw body as text for every /iclock/* route.
admsRouter.use(express.text({ type: "*/*", limit: "5mb" }));

// Unconditional debug firehose (super-admin only view) - every request,
// before any routing/business logic, so it captures traffic even for
// endpoints/tables the handlers below don't otherwise understand.
admsRouter.use(logRawRequest);

admsRouter.get("/cdata", handleCdataGet);
admsRouter.post("/cdata", handleCdataPost);
admsRouter.get("/getrequest", handleGetRequest);
admsRouter.post("/devicecmd", handleDeviceCmd);
admsRouter.get("/test", handleTest);
admsRouter.post("/test", handleTest);
