import { getDatabase, type Database } from "./db.js";

/**
 * User store. One table, one shape. All authentication reads through here.
 *
 * Passwords are stored as provided (not hashed): the Subsonic token scheme is
 * md5(password + salt), which the server must be able to compute, so a
 * one-way hash would break every Subsonic client. This is the same posture the
 * deployment's ADMIN_PASSWORD env var had before.
 */

export type Role = "admin" | "user";

export interface User {
  username: string;
  password: string;
  role: Role;
  createdAt: string;
}

/** User shape safe to send to clients (no password). */
export interface PublicUser {
  username: string;
  role: Role;
  createdAt: string;
}

export class ValidationError extends Error {}
export class DuplicateUserError extends Error {}
export class SetupCompleteError extends Error {}

const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{1,64}$/;

export function validateUsername(username: string): string | null {
  if (!USERNAME_PATTERN.test(username)) {
    return "Username must be 1-64 characters using letters, digits, or . _ @ -";
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 1) return "Password must not be empty.";
  if (password.length > 256) return "Password must be at most 256 characters.";
  return null;
}

const USER_COLUMNS = "username, password, role, created_at";

interface UserRow {
  username: string;
  password: string;
  role: string;
  created_at: string;
}

function toUser(row: UserRow): User {
  return {
    username: row.username,
    password: row.password,
    role: row.role === "admin" ? "admin" : "user",
    createdAt: row.created_at,
  };
}

export function toPublicUser(user: User): PublicUser {
  return { username: user.username, role: user.role, createdAt: user.createdAt };
}

export function isAdmin(user: User): boolean {
  return user.role === "admin";
}

export type DeletionBlock = "cannot-delete-self" | "last-admin";

/**
 * Policy for deleting a user. Kept pure so it can be unit tested without HTTP.
 */
export function deletionBlockedReason(
  target: User,
  actor: User,
  adminCount: number,
): DeletionBlock | null {
  if (target.username === actor.username) return "cannot-delete-self";
  if (target.role === "admin" && adminCount <= 1) return "last-admin";
  return null;
}

function assertUsername(username: string): void {
  const error = validateUsername(username);
  if (error) throw new ValidationError(error);
}

function assertPassword(password: string): void {
  const error = validatePassword(password);
  if (error) throw new ValidationError(error);
}

export function createUserStore(db: Database) {
  const findUser = (username: string): User | null => {
    const row = db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username = ?`)
      .get(username) as UserRow | undefined;
    return row ? toUser(row) : null;
  };

  const listUsers = (): User[] => {
    const rows = db
      .prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY username`)
      .all() as UserRow[];
    return rows.map(toUser);
  };

  const countUsers = (): number => {
    const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    return row.n;
  };

  const countAdmins = (): number => {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
      .get() as { n: number };
    return row.n;
  };

  const createUser = (input: { username: string; password: string; role?: Role }): User => {
    const username = input.username.trim();
    const role: Role = input.role === "admin" ? "admin" : "user";
    assertUsername(username);
    assertPassword(input.password);
    try {
      db.prepare(
        "INSERT INTO users (username, password, role, created_at) VALUES (?, ?, ?, ?)",
      ).run(username, input.password, role, new Date().toISOString());
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
        throw new DuplicateUserError(`User '${username}' already exists.`);
      }
      throw err;
    }
    const created = findUser(username);
    if (!created) throw new Error(`failed to read back created user: ${username}`);
    return created;
  };

  /** One-shot bootstrap: succeeds only while the users table is empty. */
  const createFirstAdmin = (username: string, password: string): User => {
    if (countUsers() > 0) {
      throw new SetupCompleteError("Setup has already been completed.");
    }
    return createUser({ username, password, role: "admin" });
  };

  const deleteUser = (username: string): boolean => {
    return db.prepare("DELETE FROM users WHERE username = ?").run(username).changes > 0;
  };

  const setPassword = (username: string, password: string): boolean => {
    assertPassword(password);
    return (
      db.prepare("UPDATE users SET password = ? WHERE username = ?").run(password, username)
        .changes > 0
    );
  };

  return {
    findUser,
    listUsers,
    countUsers,
    countAdmins,
    createUser,
    createFirstAdmin,
    deleteUser,
    setPassword,
  };
}

export type UserStore = ReturnType<typeof createUserStore>;

let store: UserStore | null = null;

/** Process-wide store backed by the configured SQLite file. */
export function getUserStore(): UserStore {
  if (!store) {
    store = createUserStore(getDatabase());
  }
  return store;
}

/** Test hook: drop the cached store so the next call re-opens the database. */
export function resetUserStore(): void {
  store = null;
}
