import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { appLogger as logger } from "./logger";
import { admsRouter, clearReservedCompanySlug } from "./adms/router";
import { adminApiRouter } from "./admin/router";
import { errorHandler } from "./middleware/errorHandler";
import { prisma } from "./db/client";

// Builds the Express app without binding a port - split out of server.ts so
// tests (supertest et al.) can exercise the real middleware stack (CORS,
// body parsing, auth, every mounted router) in-process, with no network
// listener and no dependency on seedBootstrapAdmin ever having run.
export function buildApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");

  // Console log of every incoming HTTP request, registered before anything
  // else so it also catches requests that match no route at all - the case
  // that motivated it: a device firmware pinging a path we don't serve
  // (e.g. bare /iclock/cdata with no company prefix) previously 404'd with
  // zero trace anywhere. Plain console.log, not pino - this is a
  // watch-the-terminal debugging aid, one readable line per event.
  //
  // Logged at arrival ([req]) AND at completion ([res]), not just on
  // finish: a request that hangs or whose client aborts mid-response never
  // fires "finish", and would otherwise leave no trace despite having
  // fully arrived. (Connections that never produce a parseable HTTP
  // request at all can't reach any Express middleware - those are covered
  // by the [tcp] socket-level logs in server.ts's listen setup.)
  app.use((req, res, next) => {
    const startedAt = Date.now();
    console.log(`[req] ${req.method} ${req.originalUrl} (from ${req.ip})`);
    res.on("finish", () => {
      console.log(
        `[res] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`
      );
    });
    next();
  });

  // --- Device-facing ADMS routes: unauthenticated, no CSRF, no JSON body
  // parser ahead of it. Sits in complete isolation from the admin
  // middleware stack below (registered before it, not after) so it never
  // passes through cors/json/cookie-parser.
  //
  // Every device now goes through a company's own URL
  // (`http://host:port/<companySlug>/<secret>`, firmware appends the usual
  // /iclock/* suffixes after that base) - there is no bare /iclock
  // fallback anymore. companySlug scopes a not-yet-claimed device's
  // pending ping to the right company; secret continues to validate an
  // already-claimed device's identity exactly as before, unaffected by
  // which slug it arrived with. Reserved words (admin/api/health) can
  // never resolve as a real company slug even though the wildcard would
  // otherwise accept any string here; clearReservedCompanySlug strips it
  // before the shared admsRouter ever sees it, on top of the fact that
  // neither /admin nor /api/admin has "iclock" as its third path segment,
  // so a real collision with those fixed routes is unreachable regardless.
  app.use("/:companySlug/:secret/iclock", clearReservedCompanySlug, admsRouter);

  // --- Admin API: JSON body parsing, cookies, CORS, auth. Never applies to
  // /iclock/* because the ADMS mount above is registered before this point. ---
  app.use(
    cors({
      origin: process.env.ADMIN_UI_ORIGIN ?? true,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/api/admin", adminApiRouter);

  // Backend service, not a content site - nothing here is meant to be
  // crawled or indexed, by search engines or AI/LLM crawlers alike.
  // Disallowing "/" for User-agent: * covers every crawler that respects
  // robots.txt (GPTBot, ClaudeBot, CCBot, Google-Extended, Bingbot,
  // Googlebot, etc.) without maintaining a name-by-name list.
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /\n");
  });

  // Nothing is actually served at "/" - the admin UI lives under /admin,
  // and device traffic requires a company-slug prefix. Redirect straight
  // there instead of a bare 404 on the bookmark-this-server default path.
  app.get("/", (_req, res) => res.redirect(301, "/admin"));

  // --- Static admin SPA build (if present) ---
  const adminUiDist = path.join(__dirname, "..", "admin-ui", "dist");
  if (fs.existsSync(adminUiDist)) {
    app.use("/admin", express.static(adminUiDist));
    app.get("/admin/*", (_req, res) => {
      res.sendFile(path.join(adminUiDist, "index.html"));
    });
  }

  // A real DB round-trip, not just "the process is up" - orchestrators
  // (docker compose healthcheck, k8s probes) need to know when the server
  // can't actually serve requests, not just that it's listening.
  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "health check failed - database unreachable");
      res.status(503).json({ ok: false, error: "database unreachable" });
    }
  });

  app.use(errorHandler);

  return app;
}
