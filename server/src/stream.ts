import type { Request, Response } from "express";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Byte proxy for upstream audio (archive.org). Preserves HTTP Range handling
 * so mobile clients can scrub without the whole file being buffered.
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

  let upstreamRes: import("undici").HttpResponse;
  try {
    const { request } = await import("undici");
    upstreamRes = await request(upstreamUrl, {
      method: "GET",
      headers,
      headersTimeout: config.providerTimeoutMs,
      bodyTimeout: 0, // streams can be long-lived; do not abort mid-transfer
      maxRedirections: 5,
    });
  } catch (err) {
    logger.warn({ err, upstreamUrl }, "upstream stream request failed");
    res.status(502).type("application/json").send({ error: "upstream unavailable" });
    return;
  }

  try {
    const status = upstreamRes.statusCode;
    const resHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(upstreamRes.headers)) {
      const key = name.toLowerCase();
      if (FORWARD_HEADERS.has(key) && typeof value === "string") {
        resHeaders[key] = value;
      }
    }

    if (status >= 400) {
      // Surface upstream failures without leaking upstream internals.
      const code = status === 404 || status === 403 ? 404 : 502;
      res.status(code).type("application/json").send({ error: "upstream error" });
      return;
    }

    res.status(status);
    for (const [key, value] of Object.entries(resHeaders)) {
      res.setHeader(key, value);
    }
    // Ensure caching layers do not store personalized streams.
    res.setHeader("cache-control", "no-store");

    const body = upstreamRes.body;
    res.setHeader("connection", "close");
    await new Promise<void>((resolve, reject) => {
      body.on("data", (chunk: Buffer) => {
        if (!res.write(chunk)) {
          body.pause();
          res.once("drain", () => body.resume());
        }
      });
      body.on("end", () => {
        res.end();
        resolve();
      });
      body.on("error", (err: Error) => {
        logger.warn({ err }, "upstream body error during proxying");
        res.destroy();
        reject(err);
      });
      req.on("close", () => {
        body.destroy();
        resolve();
      });
    });
  } catch (err) {
    logger.warn({ err }, "error while proxying stream");
    if (!res.headersSent) {
      res.status(502).type("application/json").send({ error: "proxy error" });
    } else {
      res.destroy();
    }
  } finally {
    upstreamRes.body.destroy();
  }
}