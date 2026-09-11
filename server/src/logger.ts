import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logLevel,
  base: { app: "privatesubsonic" },
  redact: {
    paths: ["password", "token", "req.headers.authorization"],
    censor: "[redacted]",
  },
});