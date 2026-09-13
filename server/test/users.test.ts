import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/db.js";
import {
  createUserStore,
  deletionBlockedReason,
  DuplicateUserError,
  SetupCompleteError,
  ValidationError,
  type User,
} from "../src/users.js";
import { authenticate } from "../src/auth.js";

/** Fresh in-memory database per test — no files, no shared state. */
function makeStore() {
  const db = new Database(":memory:");
  migrate(db);
  return createUserStore(db);
}

function tokenFor(password: string, salt: string): string {
  return createHash("md5").update(password + salt).digest("hex");
}

describe("user store", () => {
  it("creates and finds a user", () => {
    const store = makeStore();
    const created = store.createUser({ username: "alice", password: "secret" });
    expect(created.role).toBe("user");
    expect(store.findUser("alice")?.password).toBe("secret");
  });

  it("returns null for an unknown user", () => {
    expect(makeStore().findUser("nobody")).toBeNull();
  });

  it("rejects duplicate usernames", () => {
    const store = makeStore();
    store.createUser({ username: "alice", password: "secret" });
    expect(() => store.createUser({ username: "alice", password: "other" })).toThrow(
      DuplicateUserError,
    );
  });

  it("rejects invalid usernames and empty passwords", () => {
    const store = makeStore();
    expect(() => store.createUser({ username: "bad user!", password: "x" })).toThrow(
      ValidationError,
    );
    expect(() => store.createUser({ username: "ok", password: "" })).toThrow(ValidationError);
  });

  it("lists users sorted and counts admins", () => {
    const store = makeStore();
    store.createUser({ username: "bob", password: "x" });
    store.createUser({ username: "alice", password: "x", role: "admin" });
    expect(store.listUsers().map((u) => u.username)).toEqual(["alice", "bob"]);
    expect(store.countAdmins()).toBe(1);
  });

  it("deletes users and reports whether anything was removed", () => {
    const store = makeStore();
    store.createUser({ username: "alice", password: "x" });
    expect(store.deleteUser("alice")).toBe(true);
    expect(store.deleteUser("alice")).toBe(false);
  });

  it("changes a password and rejects empty replacements", () => {
    const store = makeStore();
    store.createUser({ username: "alice", password: "old" });
    expect(store.setPassword("alice", "new")).toBe(true);
    expect(store.findUser("alice")?.password).toBe("new");
    expect(() => store.setPassword("alice", "")).toThrow(ValidationError);
  });
});

describe("first-admin bootstrap", () => {
  it("creates the first admin while no users exist", () => {
    const store = makeStore();
    const admin = store.createFirstAdmin("root", "secret");
    expect(admin.role).toBe("admin");
    expect(store.countUsers()).toBe(1);
  });

  it("locks setup once any user exists", () => {
    const store = makeStore();
    store.createFirstAdmin("root", "secret");
    expect(() => store.createFirstAdmin("other", "secret")).toThrow(SetupCompleteError);
  });

  it("locks setup even when a non-admin user already exists", () => {
    const store = makeStore();
    store.createUser({ username: "alice", password: "x" });
    expect(() => store.createFirstAdmin("root", "secret")).toThrow(SetupCompleteError);
  });
});

describe("deletion policy", () => {
  const admin: User = { username: "root", password: "x", role: "admin", createdAt: "" };
  const second: User = { username: "other", password: "x", role: "admin", createdAt: "" };
  const user: User = { username: "alice", password: "x", role: "user", createdAt: "" };

  it("blocks deleting yourself", () => {
    expect(deletionBlockedReason(admin, admin, 2)).toBe("cannot-delete-self");
  });

  it("blocks deleting the last administrator", () => {
    expect(deletionBlockedReason(second, admin, 1)).toBe("last-admin");
  });

  it("allows deleting another user", () => {
    expect(deletionBlockedReason(user, admin, 1)).toBeNull();
  });

  it("allows deleting an admin when others remain", () => {
    expect(deletionBlockedReason(second, admin, 2)).toBeNull();
  });
});

describe("authenticate", () => {
  const setup = () => {
    const store = makeStore();
    store.createUser({ username: "alice", password: "secret" });
    store.createUser({ username: "root", password: "rootpw", role: "admin" });
    return store;
  };

  it("accepts a valid token-scheme credential", () => {
    const store = setup();
    const salt = "abc123";
    const outcome = authenticate(
      { u: "alice", t: tokenFor("secret", salt), s: salt },
      undefined,
      {},
      store,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.user.username).toBe("alice");
  });

  it("accepts a legacy plaintext password", () => {
    const store = setup();
    const outcome = authenticate({ u: "alice", p: "secret" }, undefined, {}, store);
    expect(outcome.ok).toBe(true);
  });

  it("rejects a wrong password", () => {
    const store = setup();
    const outcome = authenticate({ u: "alice", p: "wrong" }, undefined, {}, store);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe(40);
  });

  it("rejects an unknown user without revealing it", () => {
    const store = setup();
    const outcome = authenticate({ u: "ghost", p: "whatever" }, undefined, {}, store);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe(40);
  });

  it("reports a missing username", () => {
    const store = setup();
    const outcome = authenticate({}, undefined, {}, store);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe(10);
  });
});
