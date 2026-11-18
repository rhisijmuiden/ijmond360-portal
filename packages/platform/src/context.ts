import type { FastifyBaseLogger } from "fastify";
import type { RuntimeConfig } from "./config.js";
import type { SecretBox } from "./crypto.js";
import type { Db, Settings } from "./db.js";

export interface PlatformContext {
  config: RuntimeConfig;
  db: Db;
  settings: Settings;
  secrets: SecretBox;
  log: FastifyBaseLogger;
  /** Directories (absolute) included in backups in addition to the database. */
  backupPaths: string[];
}

export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

/**
 * The paths a request can be checked against. The router decodes percent-escapes (`/%61pi/users` reaches the
 * `/api/users` route), so access checks must never look at the raw URL alone: `route` is the matched route pattern
 * (e.g. `/api/users/:id`), `decoded` the decoded path without query string.
 */
export function requestPaths(req: { url: string; routeOptions?: { url?: string } }): { route: string | null; decoded: string } {
  const raw = req.url.split("?")[0]!;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* malformed escape: keep the raw path */
  }
  return { route: req.routeOptions?.url ?? null, decoded };
}

/** True when a request goes to a route under `prefix` (e.g. "/api/"), however its path was written. */
export function isUnder(req: { url: string; routeOptions?: { url?: string } }, prefix: string) {
  const { route, decoded } = requestPaths(req);
  return (route?.startsWith(prefix) ?? false) || decoded.startsWith(prefix) || req.url.startsWith(prefix);
}
