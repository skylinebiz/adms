import { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { handleCdataGet, handleCdataPost } from "./cdata";
import { handleGetRequest } from "./getrequest";
import { handleDeviceCmd } from "./devicecmd";
import { handleTest } from "./test";
import { logRawRequest } from "./rawLog";
import { RESERVED_SLUG_VALUES } from "../utils/slug";
import { deviceLogger } from "../logger";
import { config } from "../config";
import { prisma } from "../db/client";

// Express 4 does not catch a rejected promise thrown inside an async route
// handler - an unhandled DB error (e.g. Postgres unreachable) would just
// hang the request until the device's own timeout, and depending on the
// Node version can crash the *entire process* via an unhandled rejection,
// taking down every other device's in-flight connection along with it.
// Every ADMS route handler is async and touches the DB, so every one of
// them gets wrapped: this forwards any rejection to next(err), which the
// ADMS-scoped error middleware below turns into a real (plain-text) device
// response instead of a hang or a crash.
type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

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
// the raw body as text for every /iclock/* route. FACE/FINGERTMP/photo
// payloads on some firmware are the realistic reason to ever need this
// higher than the default - configurable via ADMS_MAX_BODY_SIZE (see
// config.ts) since raising it is a real memory tradeoff (each in-flight
// request buffers its whole body), not something to bump reflexively.
admsRouter.use(express.text({ type: "*/*", limit: config.admsMaxBodySize }));

// Unconditional debug firehose (super-admin only view) - every request,
// before any routing/business logic, so it captures traffic even for
// endpoints/tables the handlers below don't otherwise understand.
admsRouter.use(logRawRequest);

// Every route is registered under both its bare name and a .aspx-suffixed
// variant: ZKTeco-branded firmware calls /iclock/cdata, but eSSL-branded
// builds of the same firmware (their ADMS server, WDMS, is ASP.NET-based)
// bake in /iclock/cdata.aspx etc. - observed live from a SilkBio-101TC
// (Ver 8.0.4.6-20211110). Same protocol, same payloads, three extra
// characters of path.
const withAspx = (path: string) => [path, `${path}.aspx`];

admsRouter.get(withAspx("/cdata"), asyncHandler(handleCdataGet));
admsRouter.post(withAspx("/cdata"), asyncHandler(handleCdataPost));
admsRouter.get(withAspx("/getrequest"), asyncHandler(handleGetRequest));
admsRouter.post(withAspx("/devicecmd"), asyncHandler(handleDeviceCmd));
// handleTest is synchronous (never touches the DB) - no async wrapping needed.
admsRouter.get(withAspx("/test"), handleTest);
admsRouter.post(withAspx("/test"), handleTest);

interface PayloadTooLargeError {
  type?: string;
  status?: number;
  statusCode?: number;
  length?: number;
  limit?: number;
}

function isPayloadTooLarge(err: unknown): err is PayloadTooLargeError {
  const e = err as PayloadTooLargeError;
  return e?.type === "entity.too.large" || e?.status === 413 || e?.statusCode === 413;
}

// Catches anything the handlers above didn't handle themselves: a genuine
// bug, (via asyncHandler) a DB call that rejected - most commonly Postgres
// being unreachable - or the body-parser above rejecting an oversized
// payload before any handler even ran. Always plain text, never the admin
// API's JSON errorHandler - ZKTeco firmware parses the response as text
// and a JSON body would just confuse it into an endless malformed-response
// retry loop instead of the clean backoff-and-retry a real error gives it.
admsRouter.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;

  if (isPayloadTooLarge(err)) {
    // Unlike a transient DB error, retrying an oversized payload gets the
    // identical result forever - withholding the ack would just wedge the
    // device on it permanently. Ack `OK` so it moves on, but this is real
    // device data that got silently dropped, so log it loudly (deviceLogger
    // *and* a RawRequestLog row, same visibility as every other request,
    // so a super_admin can actually see it happened instead of it only
    // existing in server logs nobody's watching).
    const sn = typeof req.query.SN === "string" ? req.query.SN : undefined;
    deviceLogger.error(
      { sn, endpoint: req.path, limit: err.limit, length: err.length },
      "device payload exceeded ADMS_MAX_BODY_SIZE - payload was NOT recorded, acking OK anyway so the device doesn't wedge on it"
    );
    prisma.rawRequestLog
      .create({
        data: {
          serialNumber: sn ?? null,
          endpoint: req.path,
          method: req.method,
          query: JSON.stringify(req.query),
          headers: JSON.stringify(req.headers),
          rawBody: `[dropped: payload of ${err.length ?? "unknown"} bytes exceeded the ${err.limit ?? "configured"}-byte ADMS_MAX_BODY_SIZE limit]`,
        },
      })
      .catch((logErr) => deviceLogger.error({ err: logErr }, "failed to log oversized-payload drop"));
    res.status(200).type("text/plain; charset=UTF-8").send("OK");
    return;
  }

  deviceLogger.error(
    { err, path: req.path, method: req.method },
    "unhandled error in ADMS route - responding 500 so the device backs off and retries"
  );
  res.status(500).type("text/plain; charset=UTF-8").send("Internal Server Error");
});
