import { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { handleCdataGet, handleCdataPost } from "./cdata";
import { handleGetRequest } from "./getrequest";
import { handleDeviceCmd } from "./devicecmd";
import { handleTest } from "./test";
import { logRawRequest } from "./rawLog";

// Path segments that must never be treated as a device secret, even though
// the `/:secret/iclock` mount would otherwise accept any string here -
// belt-and-suspenders on top of route registration order (which already
// makes real collisions with /admin, /api/admin, /health unreachable, since
// none of those have "iclock" as their second path segment).
const RESERVED_SECRET_VALUES = new Set(["admin", "api", "health"]);

export function clearReservedSecret(req: Request, _res: Response, next: NextFunction) {
  if (req.params.secret && RESERVED_SECRET_VALUES.has(req.params.secret)) {
    delete req.params.secret;
  }
  next();
}

// This entire router is intentionally unauthenticated and CSRF-exempt:
// ZKTeco firmware cannot do logins, custom headers, or CSRF tokens. Do not
// mount any auth/session/CSRF middleware ahead of this router.
//
// mergeParams: true is required so req.params.secret (captured by the
// parent /:secret/iclock mount in server.ts) is actually visible to the
// routes below - without it, Express resets req.params for a mounted
// Router() and the secret would silently look like it was never sent.
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
