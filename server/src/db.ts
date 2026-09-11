import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * SQLite bootstrap. v0.1 keeps the catalog out of the database entirely
 * (live provider queries + in-memory cache), but the handle is created at
 * startup so later versions can rely on it without a migration of setup.
 */

export type Database = InstanceType<typeof Database>;

let db: Database | null = null;

export function getDatabase(): Database {
  if (db) {
    return db;
  }
  const file = config.databasePath;
  mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Future migrations go here. Nothing schema-y in v0.1.
  logger.info({ file }, "sqlite ready (unused in v0.1)");
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}