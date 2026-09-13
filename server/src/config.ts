import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Repo root. Two levels up is correct in both layouts: dev (server/src/…)
 * and the container (server/dist/… under /app).
 */
export const APP_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Env file loading (Node 22+ built-in), anchored to APP_ROOT so it works
 * regardless of cwd (npm workspaces run scripts with the workspace as cwd).
 * Precedence: real environment wins, then .env.local, then .env. Files are
 * optional; missing ones are skipped.
 */
for (const envFile of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(APP_ROOT, envFile));
  } catch {
    // file does not exist — fine
  }
}

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Free-form on purpose: a host may set values like "staging", and we must
  // not exit on that. Defaults to production so an unset NODE_ENV still serves
  // the built UI. `npm run dev` sets NODE_ENV=development.
  NODE_ENV: z.string().default("production"),
  /** "auto" serves the built UI except in development; true/false force it. */
  SERVE_WEB: z.enum(["auto", "true", "false"]).default("auto"),
  DATABASE_PATH: z.string().default("data/privatesubsonic.db"),
  CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(500),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  PROVIDER: z.string().default("archive-org"),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Config failures must be loud and legible — this runs before the logger exists.
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

const isDevelopment = raw.NODE_ENV === "development";

export const config = {
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  isDevelopment,
  /**
   * Whether to serve the built web UI (web/dist) from this server.
   *
   * Disabled in development on purpose: there the UI is served by Vite, and
   * serving a leftover web/dist here would shadow the live dev UI with a
   * stale build (old screens, old copy) that looks broken.
   */
  serveWeb: raw.SERVE_WEB === "true" ? true : raw.SERVE_WEB === "false" ? false : !isDevelopment,
  databasePath: path.isAbsolute(raw.DATABASE_PATH) ? raw.DATABASE_PATH : path.resolve(APP_ROOT, raw.DATABASE_PATH),
  webDistDir: path.resolve(APP_ROOT, "web", "dist"),
  cache: {
    maxEntries: raw.CACHE_MAX_ENTRIES,
    ttlSeconds: raw.CACHE_TTL_SECONDS,
  },
  provider: raw.PROVIDER,
  providerTimeoutMs: raw.PROVIDER_TIMEOUT_MS,
} as const;