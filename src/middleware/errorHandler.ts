import { NextFunction, Request, Response } from "express";
import { appLogger as logger } from "../logger";

interface ErrorWithStatus {
  status?: number;
  statusCode?: number;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  // body-parser (express.json()) attaches a real, already-correct HTTP
  // status to its own parse failures - a syntax error in the client's JSON
  // body is a 400 (their input was malformed, not our fault), and an
  // oversized body is a 413 (body-parser's own size limit, independent of
  // whatever a route's zod schema would have said). Neither is "the server
  // broke," so neither belongs behind a generic, logged-as-an-incident 500.
  // Only trust this for 4xx: some libraries stash other numbers here, and
  // anything outside the client-error range should still fall through to
  // the generic path below.
  const { status: rawStatus, statusCode: rawStatusCode } = (err ?? {}) as ErrorWithStatus;
  const status = rawStatus ?? rawStatusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    logger.warn({ err, path: req.path, method: req.method }, "client error in admin API");
    res.status(status).json({ error: status === 413 ? "Request body too large" : "Malformed request" });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, "unhandled error in admin API");
  res.status(500).json({ error: "Internal server error" });
}
