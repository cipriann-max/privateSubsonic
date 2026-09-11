import { createHash, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

/**
 * Subsonic/OpenSubsonic wire protocol helpers:
 * authentication (token scheme), error codes, and response envelope basics.
 */

/** Subsonic API error codes (fixed by the spec). */
export const SUBSONIC_ERROR = {
  GENERIC: 0,
  MISSING_PARAM: 10,
  CLIENT_TOO_OLD: 20,
  WRONG_USERNAME_OR_PASSWORD: 40,
  TOKEN_AUTH_NOT_SUPPORTED: 41,
  NOT_AUTHORIZED: 50,
  NOT_FOUND: 70,
} as const;

export interface SubsonicError {
  code: number;
  message: string;
}

export interface SubsonicAuthParams {
  username?: string;
  /** Hex md5 of (password + salt). */
  token?: string;
  /** Salt string provided by the client. */
  salt?: string;
  /** Legacy plaintext auth; accepted only when no token/salt pair is present. */
  password?: string;
}

export type AuthResult =
  | { ok: true }
  | { ok: false; error: SubsonicError };

/**
 * Extract auth params from query string and/or form-encoded body.
 * Subsonic clients are inconsistent about which they use.
 */
export function extractAuthParams(
  query: Record<string, unknown>,
  body: unknown,
  headers: IncomingHttpHeaders,
): SubsonicAuthParams {
  const read = (key: string): string | undefined => {
    const fromQuery = query[key];
    if (typeof fromQuery === "string" && fromQuery.length > 0) return fromQuery;
    if (body && typeof body === "object" && key in body) {
      const value = (body as Record<string, unknown>)[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return undefined;
  };
  // Basic auth fallback (some clients use it with hex-encoded password)
  const auth = headers.authorization;
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx >= 0) {
        return {
          username: decoded.slice(0, idx),
          password: decoded.slice(idx + 1),
        };
      }
    } catch {
      // fall through to query params
    }
  }
  return {
    username: read("u"),
    token: read("t"),
    salt: read("s"),
    password: read("p"),
  };
}

function md5Hex(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/**
 * Verify credentials against the configured admin account.
 * Accepts:
 *  - token scheme: t = md5(password + s)
 *  - legacy plaintext: p = "password" or "enc:<hex>" (spec allows both)
 */
export function verifyCredentials(
  params: SubsonicAuthParams,
  expected: { username: string; password: string },
): AuthResult {
  const { username, token, salt, password } = params;

  if (!username || typeof username !== "string") {
    return { ok: false, error: { code: SUBSONIC_ERROR.MISSING_PARAM, message: "Required parameter 'u' is missing." } };
  }
  if (username !== expected.username) {
    return { ok: false, error: { code: SUBSONIC_ERROR.WRONG_USERNAME_OR_PASSWORD, message: "Wrong username or password." } };
  }

  if (token !== undefined && salt !== undefined) {
    if (token.length === 0 || salt.length === 0) {
      return { ok: false, error: { code: SUBSONIC_ERROR.MISSING_PARAM, message: "Required parameters 't' and 's' are missing." } };
    }
    const expectedToken = md5Hex(expected.password + salt);
    // Constant-time compare to keep timing attacks out of scope-cheap.
    const a = Buffer.from(token.toLowerCase(), "utf8");
    const b = Buffer.from(expectedToken, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { ok: true };
    }
    return { ok: false, error: { code: SUBSONIC_ERROR.WRONG_USERNAME_OR_PASSWORD, message: "Wrong username or password." } };
  }

  if (password !== undefined && password.length > 0) {
    let candidate = password;
    if (password.startsWith("enc:")) {
      candidate = Buffer.from(password.slice(4), "hex").toString("utf8");
    }
    if (candidate === expected.password) {
      return { ok: true };
    }
    return { ok: false, error: { code: SUBSONIC_ERROR.WRONG_USERNAME_OR_PASSWORD, message: "Wrong username or password." } };
  }

  return { ok: false, error: { code: SUBSONIC_ERROR.MISSING_PARAM, message: "Required parameters 't' and 's' (or 'p') are missing." } };
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  return nodeTimingSafeEqual(a, b);
}

/** Generate a random salt for cookie/session-ish needs. Not the client salt. */
export function randomSalt(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

export { md5Hex };