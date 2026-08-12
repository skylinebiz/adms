import { NextFunction, Request, Response } from "express";
import { appLogger as logger } from "../logger";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  logger.error({ err, path: req.path, method: req.method }, "unhandled error in admin API");
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
}
