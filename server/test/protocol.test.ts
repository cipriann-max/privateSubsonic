import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractAuthParams, SUBSONIC_ERROR, verifyCredentials } from "../src/subsonic/protocol.js";

const expected = { username: "admin", password: "secret" };

function tokenFor(password: string, salt: string): string {
  return createHash("md5").update(password + salt).digest("hex");
}

describe("verifyCredentials", () => {
  it("accepts a valid token scheme credential", () => {
    const salt = "abc123";
    const result = verifyCredentials(
      { username: "admin", token: tokenFor("secret", salt), salt },
      expected,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a wrong token", () => {
    const result = verifyCredentials(
      { username: "admin", token: tokenFor("wrong", "salt"), salt: "salt" },
      expected,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(SUBSONIC_ERROR.WRONG_USERNAME_OR_PASSWORD);
    }
  });

  it("rejects an unknown username with 40", () => {
    const result = verifyCredentials(
      { username: "intruder", token: tokenFor("secret", "s"), salt: "s" },
      expected,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(SUBSONIC_ERROR.WRONG_USERNAME_OR_PASSWORD);
    }
  });

  it("accepts legacy plaintext password", () => {
    const result = verifyCredentials({ username: "admin", password: "secret" }, expected);
    expect(result.ok).toBe(true);
  });

  it("accepts legacy hex-encoded password (enc: prefix)", () => {
    const hex = Buffer.from("secret", "utf8").toString("hex");
    const result = verifyCredentials({ username: "admin", password: `enc:${hex}` }, expected);
    expect(result.ok).toBe(true);
  });

  it("returns MISSING_PARAM when username is absent", () => {
    const result = verifyCredentials({}, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(SUBSONIC_ERROR.MISSING_PARAM);
    }
  });

  it("returns MISSING_PARAM when token present but salt missing", () => {
    const result = verifyCredentials(
      { username: "admin", token: tokenFor("secret", "x") },
      expected,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(SUBSONIC_ERROR.MISSING_PARAM);
    }
  });
});

describe("extractAuthParams", () => {
  it("reads from query params", () => {
    const params = extractAuthParams(
      { u: "admin", t: "tok", s: "salt" },
      undefined,
      {},
    );
    expect(params).toEqual({ username: "admin", token: "tok", salt: "salt", password: undefined });
  });

  it("reads from form-encoded body when query is empty", () => {
    const params = extractAuthParams(
      {},
      { u: "admin", p: "secret" },
      {},
    );
    expect(params).toEqual({ username: "admin", token: undefined, salt: undefined, password: "secret" });
  });

  it("prefers query over body", () => {
    const params = extractAuthParams(
      { u: "admin" },
      { u: "other" },
      {},
    );
    expect(params.username).toBe("admin");
  });

  it("parses basic auth header", () => {
    const header = `Basic ${Buffer.from("admin:secret", "utf8").toString("base64")}`;
    const params = extractAuthParams({}, undefined, { authorization: header });
    expect(params.username).toBe("admin");
    expect(params.password).toBe("secret");
  });
});