import { describe, expect, it } from "vitest";
import {
  extensionOf,
  parseLength,
  artistIdFor,
  normalizeTitle,
} from "../src/subsonic/providers/archive-org.js";

describe("parseLength", () => {
  it("parses plain seconds", () => {
    expect(parseLength("272.0")).toBe(272);
  });

  it("parses mm:ss", () => {
    expect(parseLength("4:32")).toBe(272);
  });

  it("parses h:mm:ss", () => {
    expect(parseLength("1:02:03")).toBe(3723);
  });

  it("returns 0 for garbage", () => {
    expect(parseLength("not-a-time")).toBe(0);
    expect(parseLength(undefined)).toBe(0);
  });
});

describe("extensionOf", () => {
  it("returns lowercase extension", () => {
    expect(extensionOf("Song.MP3")).toBe("mp3");
  });

  it("returns empty string without a dot", () => {
    expect(extensionOf("noext")).toBe("");
  });
});

describe("artistIdFor", () => {
  it("slugifies artist names", () => {
    expect(artistIdFor("Charlie Parker")).toBe("ar-charlie-parker");
  });

  it("strips unsafe characters", () => {
    expect(artistIdFor("AC/DC!")).toBe("ar-ac-dc");
  });
});

describe("normalizeTitle", () => {
  it("replaces underscores with spaces", () => {
    expect(normalizeTitle("id", "My_Cool_Song")).toBe("My Cool Song");
  });

  it("falls back to the identifier for empty titles", () => {
    expect(normalizeTitle("ItemId", "")).toBe("ItemId");
  });
});