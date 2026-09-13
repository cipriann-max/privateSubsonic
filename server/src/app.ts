import path from "node:path";
import compression from "compression";
import express, { static as serveStatic, type Request, type Response, type NextFunction } from "express";
import { pinoHttp } from "pino-http";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getDatabase } from "./db.js";
import { subsonicRouter } from "./subsonic/router.js";
import { apiRouter } from "./api.js";

export function createApp() {
  // Touch the database once at boot so bind-mounted volumes are created and
  // permissions problems surface immediately rather than on first write.
  getDatabase();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Coolify/traefik/nginx
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/healthz" } }));
  app.use(compression());
  // Management API parses JSON bodies (the /rest API uses query strings).
  app.use(express.json());

  // Liveness for Docker/Coolify.
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // JSON management API for the web UI (users, first-run setup).
  app.use("/api", apiRouter());

  // The OpenSubsonic API. `.view` suffix routes are registered alongside.
  app.use("/rest", subsonicRouter());

  // Static web player (built by the web workspace).
  //
  // Only served in production by default. In dev the UI is served by Vite
  // (web/vite.config.ts proxies /rest and /api here); serving web/dist from
  // this port too would shadow the live dev UI with a stale build. Override
  // with SERVE_WEB=true if you want to exercise the built UI locally.
  const webDist = config.webDistDir;
  if (config.serveWeb && existsSync(webDist)) {
    logger.info({ webDist }, "serving built web UI");
    app.use(serveStatic(webDist, { index: "index.html", maxAge: "1h" }));
    // SPA fallback for client routing; API paths are excluded.
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/rest") || req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, "index.html"));
    });
  } else {
    if (!config.serveWeb) {
      logger.info("web UI is served by Vite in dev; this server does not serve web/dist");
    }
    app.get("/", (_req, res) => {
      res
        .status(200)
        .type("text/plain")
        .send(
          config.serveWeb
            ? "privateSubsonic API is running. Web player not built — run `npm run build`."
            : "privateSubsonic API is running. In dev the web UI is served by Vite at http://localhost:5173.",
        );
    });
  }

  // JSON error handler (express 5 async errors land here).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "unhandled error");
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).type("application/json").send({ error: "internal error" });
  });

  return app;
}