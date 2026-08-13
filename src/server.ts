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

async function main() {
  await seedBootstrapAdmin();

  const app = express();
  app.disable("x-powered-by");

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
