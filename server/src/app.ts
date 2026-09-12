import path from "node:path";
import compression from "compression";
import express, { static as serveStatic, type Request, type Response, type NextFunction } from "express";
import { pinoHttp } from "pino-http";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getDatabase } from "./db.js";
import { subsonicRouter } from "./subsonic/router.js";

export function createApp() {
  // Touch the database once at boot so bind-mounted volumes are created and
  // permissions problems surface immediately rather than on first write.
  getDatabase();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Coolify/traefik/nginx
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/healthz" } }));
  app.use(compression());

  // Liveness for Docker/Coolify.
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // The OpenSubsonic API. `.view` suffix routes are registered alongside.
  app.use("/rest", subsonicRouter());

  // Static web player (built by the web workspace). SPA fallback for client
  // routing; assets and index.html are served only when the build exists.
  const webDist = config.webDistDir;
  if (existsSync(webDist)) {
    app.use(serveStatic(webDist, { index: "index.html", maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/rest")) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      res
        .status(200)
        .send("privateSubsonic API is running. Web player not built — run `npm run build`.");
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