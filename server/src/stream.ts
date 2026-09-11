import type { Request, Response } from "express";
import { httpDispatcher } from "./http.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Byte proxy for upstream audio (archive.org). Preserves HTTP Range handling
 * so mobile clients can scrub without the whole file being buffered.
 *
 * Hard rules learned the hard way:
 * - Client disconnects are normal (skip, scrub). They must be handled as
 *   cancellation, never as unhandled stream errors — an unhandled 'error'
 *   event kills the whole Node process.
 * - Upstream errors surface as 404/502 JSON, never as a crash.
 */

const FORWARD_HEADERS = new Set([
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "last-modified",
  "etag",
]);

export async function proxyStream(upstreamUrl: string, req: Request, res: Response): Promise<void> {
  const headers: Record<string, string> = { "user-agent": "privateSubsonic/0.1" };
  const range = req.headers.range;
  if (typeof range === "string" && range.length > 0) {
    headers.range = range;
  }

  let upstreamRes: Awaited<ReturnType<typeof import("undici").request>>;
  try {
    const { request } = await import("undici");
    upstreamRes = await request(upstreamUrl, {
      method: "GET",
      dispatcher: httpDispatcher,
      headers,
      headersTimeout: config.providerTimeoutMs,
      bodyTimeout: 0, // streams can be long-lived; do not abort mid-transfer
    });
  } catch (err) {
    logger.warn({ err, upstreamUrl }, "upstream stream request failed");
    if (!res.headersSent) {
      res.status(502).type("application/json").send({ error: "upstream unavailable" });
    }
    return;
  }

  const { statusCode, body } = upstreamRes;

  try {
    if (statusCode >= 400) {
      const code = statusCode === 404 || statusCode === 403 || statusCode === 401 ? 404 : 502;
      // Attach the upstream status for debugging restricted/lending items.
      logger.debug({ upstreamUrl, upstreamStatus: statusCode }, "upstream stream error");
      if (!res.headersSent) {
        res.status(code).type("application/json").send({ error: "upstream error", upstreamStatus: statusCode });
      }
      body.destroy();
      return;
    }

    res.status(statusCode);
    for (const [name, value] of Object.entries(upstreamRes.headers)) {
      const key = name.toLowerCase();
      if (FORWARD_HEADERS.has(key) && typeof value === "string") {
        res.setHeader(key, value);
      }
    }
    res.setHeader("cache-control", "no-store");

    await new Promise<void>((resolve) => {
      // Belt and braces: any error on either side resolves (never rejects) —
      // responses on half-consumed streams are not recoverable and must not
      // escalate to an unhandled 'error' event on the process.
      const cleanup = () => {
        body.destroy();
        resolve();
      };

      body.on("error", (err: Error) => {
        logger.debug({ err }, "upstream body error during proxying (client likely left)");
        if (!res.writableEnded) {
          res.destroy();
        }
        cleanup();
      });

      req.on("error", cleanup);
      res.on("close", () => {
        if (!res.writableEnded) {
          body.destroy();
        }
        resolve();
      });

      body.pipe(res);
    });
  } catch (err) {
    logger.warn({ err }, "error while proxying stream");
    body.destroy();
    if (!res.headersSent) {
      res.status(502).type("application/json").send({ error: "proxy error" });
    } else {
      res.destroy();
    }
  }
}