import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "./logger.js";
import { authenticate } from "./auth.js";
import {
  deletionBlockedReason,
  DuplicateUserError,
  getUserStore,
  isAdmin,
  SetupCompleteError,
  toPublicUser,
  ValidationError,
  type User,
} from "./users.js";

/**
 * JSON management API for the web UI.
 *
 * Auth reuses the Subsonic token scheme (u/t/s, or legacy p) so the browser's
 * existing credentials work for both /rest and /api. Everything below
 * `/auth/status` is admin-only. No sessions, no cookies — every request
 * carries credentials, matching how the player already talks to the server.
 */

type AdminHandler = (req: Request, res: Response, actor: User) => void;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function apiRouter(): Router {
  const router = Router();
  const store = getUserStore();

  // Public: lets the UI decide between first-run setup and login.
  router.get("/auth/status", (_req, res) => {
    res.json({ needsSetup: store.countUsers() === 0 });
  });

  // Public, but only succeeds while no users exist (one-shot bootstrap).
  router.post("/setup", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const user = store.createFirstAdmin(str(body.username), str(body.password));
      logger.info({ username: user.username }, "first admin created via setup");
      res.status(201).json({ user: toPublicUser(user) });
    } catch (err) {
      if (err instanceof SetupCompleteError || err instanceof DuplicateUserError) {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      logger.error({ err }, "setup failed");
      res.status(500).json({ error: "setup failed" });
    }
  });

  function requireAdmin(handler: AdminHandler): (req: Request, res: Response) => void {
    return (req, res) => {
      const outcome = authenticate(req.query, req.body, req.headers, store);
      if (!outcome.ok) {
        res.status(401).json({ error: outcome.error.message });
        return;
      }
      if (!isAdmin(outcome.user)) {
        res.status(403).json({ error: "Administrator privileges required." });
        return;
      }
      handler(req, res, outcome.user);
    };
  }

  router.get(
    "/users",
    requireAdmin((_req, res) => {
      res.json({ users: store.listUsers().map(toPublicUser) });
    }),
  );

  router.post(
    "/users",
    requireAdmin((req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const role = body.role === "admin" ? "admin" : "user";
      try {
        const user = store.createUser({ username: str(body.username), password: str(body.password), role });
        res.status(201).json({ user: toPublicUser(user) });
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).json({ error: err.message });
          return;
        }
        if (err instanceof DuplicateUserError) {
          res.status(409).json({ error: err.message });
          return;
        }
        logger.error({ err }, "create user failed");
        res.status(500).json({ error: "create user failed" });
      }
    }),
  );

  router.delete(
    "/users/:username",
    requireAdmin((req, res, actor) => {
      const username = str(req.params.username);
      const target = store.findUser(username);
      if (!target) {
        res.status(404).json({ error: `User '${username}' not found.` });
        return;
      }
      const reason = deletionBlockedReason(target, actor, store.countAdmins());
      if (reason === "cannot-delete-self") {
        res.status(400).json({ error: "You cannot delete your own account." });
        return;
      }
      if (reason === "last-admin") {
        res.status(400).json({ error: "Cannot delete the last administrator." });
        return;
      }
      store.deleteUser(username);
      logger.info({ username, actor: actor.username }, "user deleted");
      res.json({ ok: true });
    }),
  );

  router.put(
    "/users/:username/password",
    requireAdmin((req, res) => {
      const username = str(req.params.username);
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!store.findUser(username)) {
        res.status(404).json({ error: `User '${username}' not found.` });
        return;
      }
      try {
        store.setPassword(username, str(body.password));
        logger.info({ username }, "password changed");
        res.json({ ok: true });
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).json({ error: err.message });
          return;
        }
        logger.error({ err }, "set password failed");
        res.status(500).json({ error: "set password failed" });
      }
    }),
  );

  router.use((_req, res) => {
    res.status(404).json({ error: "Unknown API endpoint." });
  });

  return router;
}
