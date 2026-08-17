import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config";
import { appLogger as logger } from "./logger";
import { admsRouter, clearReservedCompanySlug } from "./adms/router";
import { adminApiRouter } from "./admin/router";
import { errorHandler } from "./middleware/errorHandler";
import { seedBootstrapAdmin } from "./admin/seed";
import { prisma } from "./db/client";

async function main() {
  await seedBootstrapAdmin();

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
  // by the [tcp] socket-level logs on the listen server below.)
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

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "ADMS server listening");
  });

  // Socket-level visibility, beneath Express entirely: a client that opens
  // TCP but never sends a parseable HTTP request (garbage bytes, or - the
  // classic device misconfiguration - a TLS/HTTPS handshake against this
  // plain-HTTP port) never reaches any middleware, so the [req] logging
  // above can't see it. These two hooks make even that show up.
  //
  // Note: with docker-compose port publishing, remoteAddress is Docker's
  // proxy/gateway IP for every client, not the device's real LAN IP - the
  // value here is seeing THAT something connected, not who.
  server.on("connection", (socket) => {
    console.log(`[tcp] connection from ${socket.remoteAddress}:${socket.remotePort}`);
  });
  server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
    console.log(
      `[tcp] client error: ${err.code ?? err.message} - connection sent something that isn't valid HTTP for this port (TLS/HTTPS against plain HTTP? raw garbage?)`
    );
    // Per Node docs: attaching a clientError listener takes over closing
    // the socket - reply with a minimal 400 if still possible, never leak it.
    if (err.code !== "ECONNRESET" && socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } else {
      socket.destroy();
    }
  });
}

main().catch((err) => {
  logger.error({ err }, "server failed to start");
  process.exit(1);
});
