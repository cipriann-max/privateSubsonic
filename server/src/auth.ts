import type { IncomingHttpHeaders } from "node:http";
import {
  extractAuthParams,
  verifyCredentials,
  SUBSONIC_ERROR,
  type SubsonicError,
} from "./subsonic/protocol.js";
import { getUserStore, type User, type UserStore } from "./users.js";

/**
 * Shared authentication for both surfaces: the Subsonic `/rest` API and the
 * JSON management `/api`. Credentials always come from the users table; the
 * deployment's env vars no longer participate in authentication.
 */

export type AuthOutcome = { ok: true; user: User } | { ok: false; error: SubsonicError };

export function authenticate(
  query: Record<string, unknown>,
  body: unknown,
  headers: IncomingHttpHeaders,
  store: UserStore = getUserStore(),
): AuthOutcome {
  const params = extractAuthParams(query, body, headers);

  if (!params.username || params.username.length === 0) {
    return {
      ok: false,
      error: { code: SUBSONIC_ERROR.MISSING_PARAM, message: "Required parameter 'u' is missing." },
    };
  }

  const user = store.findUser(params.username);
  if (!user) {
    // Same error as a bad password: do not reveal which usernames exist.
    return {
      ok: false,
      error: {
        code: SUBSONIC_ERROR.WRONG_USERNAME_OR_PASSWORD,
        message: "Wrong username or password.",
      },
    };
  }

  const result = verifyCredentials(params, {
    username: user.username,
    password: user.password,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, user };
}
