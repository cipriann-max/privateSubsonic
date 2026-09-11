import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { closeDatabase } from "./db.js";

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "privateSubsonic listening");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  // Hard exit if graceful close hangs (e.g. long-lived streams).
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));