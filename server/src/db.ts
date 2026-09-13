import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * SQLite bootstrap. The catalog stays out of the database (live provider
 * queries + in-memory cache); the one thing persisted is the users table,
 * which is the source of truth for authentication.
 */

export type Database = InstanceType<typeof Database>;

let db: Database | null = null;

/**
 * Idempotent schema migration. Safe to run on every startup and against an
 * existing database file. Passwords are stored as supplied because the
 * Subsonic token scheme requires the server to compute md5(password + salt);
 * see README (Security notes).
 */
export function migrate(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );
  `);
}

export function getDatabase(): Database {
  if (db) {
    return db;
  }
  const file = config.databasePath;
  mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  logger.info({ file }, "sqlite ready");
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
