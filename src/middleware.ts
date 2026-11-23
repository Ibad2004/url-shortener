import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors.js";

export function logger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
}

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, "Route not found"));
}

const DB_DOWN_ERRORS = new Set([
  "MongooseServerSelectionError",
  "MongoServerSelectionError",
  "MongoNetworkError",
  "MongoNotConnectedError",
  "MongoNetworkTimeoutError",
]);

function bodyParserType(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "type" in err && typeof err.type === "string") {
    return err.type;
  }
  return undefined;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const type = bodyParserType(err);
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON in request body" });
    return;
  }
  if (type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large" });
    return;
  }
  if (err instanceof Error && DB_DOWN_ERRORS.has(err.name)) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }
  console.error("Unhandled error:", err instanceof Error ? err.message : "unknown");
  res.status(500).json({ error: "Internal server error" });
}
