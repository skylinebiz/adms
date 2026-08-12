import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config";
import { appLogger as logger } from "./logger";
import { admsRouter } from "./adms/router";
import { adminApiRouter } from "./admin/router";
import { errorHandler } from "./middleware/errorHandler";
import { seedBootstrapAdmin } from "./admin/seed";

async function main() {
  await seedBootstrapAdmin();

  const app = express();
  app.disable("x-powered-by");

  // --- Device-facing ADMS routes: unauthenticated, no CSRF, no JSON body
  // parser ahead of them. Mounted first and in complete isolation from the
  // admin middleware stack below. ---
  app.use("/iclock", admsRouter);

  // --- Admin API: JSON body parsing, cookies, CORS, auth. Never applies to
  // /iclock/* because it's registered after that mount and admsRouter does
  // not call next() past its own routes for unmatched paths outside /iclock. ---
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
