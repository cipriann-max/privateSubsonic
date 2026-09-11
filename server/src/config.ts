import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Env file loading (Node 22+ built-in). Precedence: real environment wins,
 * then .env.local, then .env. Files are optional; missing ones are skipped.
 */
for (const envFile of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // file does not exist — fine
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Root of the deployed app. In dev this is the repo root; in Docker the
 * dist layout keeps the same relative depth (dist/config.js -> .. = /app).
 */
export const APP_ROOT = path.resolve(__dirname, "..");

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4533),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ADMIN_USER: z.string().min(1).default("admin"),
  ADMIN_PASSWORD: z.string().min(1).default("changeme"),
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

export const config = {
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  adminUser: raw.ADMIN_USER,
  adminPassword: raw.ADMIN_PASSWORD,
  databasePath: path.isAbsolute(raw.DATABASE_PATH) ? raw.DATABASE_PATH : path.resolve(APP_ROOT, raw.DATABASE_PATH),
  webDistDir: path.resolve(APP_ROOT, "web", "dist"),
  cache: {
    maxEntries: raw.CACHE_MAX_ENTRIES,
    ttlSeconds: raw.CACHE_TTL_SECONDS,
  },
  provider: raw.PROVIDER,
  providerTimeoutMs: raw.PROVIDER_TIMEOUT_MS,
} as const;