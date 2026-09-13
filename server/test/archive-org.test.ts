import { describe, expect, it } from "vitest";
import {
  buildSearchQuery,
  coverArtIdFor,
  extensionOf,
  isRealCoverFile,
  isSingleLongRecording,
  parseLength,
  artistIdFor,
  normalizeTitle,
  selectPreferredAudioFiles,
  trackKeyOf,
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

describe("buildSearchQuery", () => {
  it("constrains results to music collections", () => {
    const q = buildSearchQuery("jazz");
    expect(q).toContain("collection:(georgeblood OR etree OR audio_music)");
  });

  it("requires mediatype audio and excludes podcasts and lending items", () => {
    const q = buildSearchQuery("jazz");
    expect(q).toContain("mediatype:(audio)");
    expect(q).toContain("NOT collection:(podcasts)");
    expect(q).toContain("NOT access-restricted-item:true");
  });

  it("searches metadata fields, not full text", () => {
    const q = buildSearchQuery("jazz");
    expect(q).toContain("subject:(jazz)");
    expect(q).toContain("creator:(jazz)");
    expect(q).toContain("title:(jazz)");
    expect(q).not.toContain("text:");
  });

  it("quotes multi-word terms as phrases", () => {
    const q = buildSearchQuery("charlie parker");
    expect(q).toContain('subject:("charlie parker")');
    expect(q).toContain('creator:("charlie parker")');
  });

  it("strips quotes from user input", () => {
    const q = buildSearchQuery('jazz" OR collection:podcasts');
    expect(q).not.toContain('jazz" OR');
  });

  it("browses collections without a term clause for an empty query", () => {
    const q = buildSearchQuery("   ");
    expect(q).toContain("collection:(georgeblood OR etree OR audio_music)");
    expect(q).not.toContain("subject:");
    expect(q.endsWith("NOT access-restricted-item:true")).toBe(true);
  });
});

describe("isRealCoverFile", () => {
  it("accepts an original image file", () => {
    expect(isRealCoverFile({ name: "cover.jpg", source: "original" })).toBe(true);
  });

  it("rejects Archive.org's auto-generated tile", () => {
    expect(isRealCoverFile({ name: "__ia_thumb.jpg", source: "original" })).toBe(false);
  });

  it("rejects generated spectrograms and per-track artwork", () => {
    expect(isRealCoverFile({ name: "track_spectrogram.png", source: "derivative" })).toBe(false);
    expect(isRealCoverFile({ name: "track.png", source: "derivative" })).toBe(false);
  });

  it("rejects non-image files", () => {
    expect(isRealCoverFile({ name: "song.mp3", source: "original" })).toBe(false);
  });
});

describe("coverArtIdFor", () => {
  it("returns the item id when a real cover exists", () => {
    expect(coverArtIdFor("item1", [{ name: "cover.png", source: "original" }])).toBe("item1");
  });

  it("returns an empty string when only auto-generated images exist", () => {
    expect(coverArtIdFor("item1", [{ name: "__ia_thumb.jpg", source: "original" }])).toBe("");
    expect(coverArtIdFor("item1", [])).toBe("");
  });
});

describe("isSingleLongRecording", () => {
  const track = (durationSeconds: number) => ({ durationSeconds });

  it("rejects a single very long file (DJ mix / radio show)", () => {
    expect(isSingleLongRecording([track(2 * 60 * 60)])).toBe(true);
    expect(isSingleLongRecording([track(1801)])).toBe(true);
  });

  it("keeps a single normal-length recording", () => {
    expect(isSingleLongRecording([track(1800)])).toBe(false);
  });

  it("keeps multi-track albums regardless of total length", () => {
    expect(isSingleLongRecording([track(2400), track(2400)])).toBe(false);
  });

  it("keeps empty track lists", () => {
    expect(isSingleLongRecording([])).toBe(false);
  });
});

describe("trackKeyOf", () => {
  it("maps a file and its derivatives to one key", () => {
    expect(trackKeyOf({ name: "Crazeology - Charlie Parker.flac" })).toBe(
      trackKeyOf({ name: "Crazeology - Charlie Parker.mp3" }),
    );
  });

  it("treats underscores and spaces in the base name as equivalent", () => {
    expect(trackKeyOf({ name: "My_Track.flac" })).toBe(trackKeyOf({ name: "My Track.mp3" }));
  });

  it("keeps distinct recordings distinct", () => {
    expect(trackKeyOf({ name: "01 A.mp3" })).not.toBe(trackKeyOf({ name: "02 B.mp3" }));
  });
});

describe("selectPreferredAudioFiles", () => {
  it("collapses a lossless original and its lossy derivative into one track", () => {
    const selected = selectPreferredAudioFiles([
      { name: "Track.flac", source: "original" },
      { name: "Track.mp3", source: "derivative" },
    ]);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.name).toBe("Track.flac");
  });

  it("prefers lossless even when the lossy derivative comes first", () => {
    const selected = selectPreferredAudioFiles([
      { name: "Song.mp3", source: "derivative" },
      { name: "Song.flac", source: "original" },
    ]);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.name).toBe("Song.flac");
  });

  it("ranks lossless formats above lossy ones", () => {
    const selected = selectPreferredAudioFiles([
      { name: "A.mp3", source: "original" },
      { name: "A.ogg", source: "original" },
    ]);
    expect(selected[0]?.name).toBe("A.ogg");
  });

  it("prefers the original when the formats tie", () => {
    const selected = selectPreferredAudioFiles([
      { name: "A_Track.mp3", source: "derivative" },
      { name: "A Track.mp3", source: "original" },
    ]);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.source).toBe("original");
  });

  it("keeps distinct recordings", () => {
    const selected = selectPreferredAudioFiles([
      { name: "01 A.mp3", source: "original" },
      { name: "02 B.mp3", source: "original" },
    ]);
    expect(selected).toHaveLength(2);
  });

  it("ignores non-audio files", () => {
    const selected = selectPreferredAudioFiles([
      { name: "cover.jpg", source: "original" },
      { name: "notes.txt", source: "original" },
      { name: "track.mp3", source: "original" },
    ]);
    expect(selected.map((f) => f.name)).toEqual(["track.mp3"]);
  });
});