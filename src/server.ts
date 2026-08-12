import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config";
import { appLogger as logger } from "./logger";
import { admsRouter, clearReservedSecret } from "./adms/router";
import { adminApiRouter } from "./admin/router";
import { errorHandler } from "./middleware/errorHandler";
import { seedBootstrapAdmin } from "./admin/seed";

async function main() {
  await seedBootstrapAdmin();

  const app = express();
  app.disable("x-powered-by");

  // --- Device-facing ADMS routes: unauthenticated, no CSRF, no JSON body
  // parser ahead of them. Both mounts sit in complete isolation from the
  // admin middleware stack below (registered before it, not after) so
  // neither ever passes through cors/json/cookie-parser.
  //
  // The plain /iclock mount is the legacy open path. The /:secret/iclock
  // mount is new: a device's Cloud Server URL can include a path
  // (`http://host:port/<secret>`), and its firmware appends the usual
  // /iclock/* suffixes after that base - only this mount populates
  // req.params.secret. Reserved words (admin/api/health) can never
  // function as a secret even though the wildcard would otherwise accept
  // any string here; clearReservedSecret strips it before the shared
  // admsRouter ever sees it, on top of the fact that neither /admin nor
  // /api/admin has "iclock" as its second path segment, so a real
  // collision with those fixed routes is unreachable regardless.
  app.use("/iclock", admsRouter);
  app.use("/:secret/iclock", clearReservedSecret, admsRouter);

  // --- Admin API: JSON body parsing, cookies, CORS, auth. Never applies to
  // /iclock/* because both ADMS mounts are registered before this point. ---
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

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use(errorHandler);

  app.listen(config.port, () => {
    logger.info({ port: config.port }, "ADMS server listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "server failed to start");
  process.exit(1);
});
