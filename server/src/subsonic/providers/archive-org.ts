import { request } from "undici";
import { httpDispatcher } from "../../http.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import { cached } from "../../cache.js";
import type {
  Album,
  Artist,
  Provider,
  SearchOpts,
  SearchResult,
  Track,
} from "./types.js";

/**
 * Live Internet Archive provider.
 *
 * Search: https://archive.org/advancedsearch.php (JSON).
 * Item metadata: https://archive.org/metadata/<identifier> (JSON).
 *
 * Known reality: archive.org item metadata is wildly inconsistent. Some
 * items are proper albums (files with track numbers), some are big dumps of
 * files with no structure. Normalization here aims for "browsing is
 * tolerable", not perfection.
 */

const IA_SEARCH_URL = "https://archive.org/advancedsearch.php";
const IA_METADATA_URL = "https://archive.org/metadata";
const AUDIO_EXTENSIONS = new Set(["mp3", "flac", "ogg", "oga", "m4a", "wav", "aac", "opus"]);

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  wav: "audio/x-wav",
  aac: "audio/aac",
  opus: "audio/opus",
};

/**
 * Music-only collections. Archive.org's default search is full-text across its
 * entire audio dump, which surfaces talk radio, podcasts and random uploads.
 * Restricting to these collections makes the library actually musical:
 *   georgeblood — Great 78 Project (pre-1950s 78rpm transfers, jazz-heavy,
 *                 professionally catalogued artist/title/year metadata)
 *   etree       — Live Music Archive (trade-friendly live recordings)
 *   audio_music — umbrella collection that excludes talk/radio/podcasts
 */
export const MUSIC_COLLECTIONS = ["georgeblood", "etree", "audio_music"] as const;

/** A lone audio file longer than this is a DJ mix / radio show, not an album. */
export const MAX_SINGLE_TRACK_SECONDS = 1800;

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

/** Archive.org auto-generates these; they are not real cover art. */
const AUTO_IMAGE_PATTERN = /^(__ia_thumb|.*_spectrogram|.*_itemimage)/i;

/**
 * Audio formats in preference order (lossless first). Archive.org keeps a
 * lossless original alongside generated lossy derivatives of the same
 * recording, so we must pick one rather than list both.
 */
const FORMAT_PREFERENCE = ["flac", "wav", "aac", "opus", "ogg", "oga", "m4a", "mp3"];

interface IaSearchDoc {
  identifier: string;
  title?: string | string[];
  creator?: string | string[];
  date?: string | string[];
  downloads?: number;
  /** Number of image files in the item (includes the auto-generated tile). */
  imagecount?: number;
}

interface IaSearchResponse {
  response?: {
    docs?: IaSearchDoc[];
    numFound?: number;
  };
}

interface IaFile {
  name: string;
  format?: string;
  size?: string | number;
  length?: string | number;
  track?: string | number;
  title?: string;
  /** "original" | "derivative" | "metadata"; derivative images are generated. */
  source?: string;
}

interface IaMetadata {
  metadata?: {
    identifier?: string;
    title?: string | string[];
    creator?: string | string[];
    date?: string | string[];
  };
  files?: IaFile[];
}

export function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await request(url, {
    method: "GET",
    dispatcher: httpDispatcher,
    headersTimeout: config.providerTimeoutMs,
    bodyTimeout: config.providerTimeoutMs,
    headers: { "user-agent": "privateSubsonic/0.1 (live provider)" },
  });
  if (res.statusCode >= 400) {
    throw new Error(`archive.org returned ${res.statusCode} for ${url}`);
  }
  return (await res.body.json()) as T;
}

function itemUrl(identifier: string, fileName: string): string {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`;
}

export function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

/** Archive.org "length" can be "4:32" or "272.0". Normalize to seconds. */
export function parseLength(raw: string | number | undefined): number {
  if (raw === undefined) return 0;
  if (typeof raw === "number") return Math.round(raw);
  const text = raw.trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number.parseFloat(text));
  const parts = text.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function normalizeTitle(identifier: string, rawTitle: string): string {
  const cleaned = rawTitle.replace(/[_]+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : identifier;
}

/** True for files that look like a real, operator-supplied cover image. */
export function isRealCoverFile(file: IaFile): boolean {
  if (!IMAGE_EXTENSIONS.has(extensionOf(file.name))) return false;
  if (AUTO_IMAGE_PATTERN.test(file.name)) return false;
  // Derivative images are auto-generated per-track artwork (spectrograms,
  // waveform tiles); only an explicit item image counts.
  if (file.source === "derivative" && !/itemimage/i.test(file.name)) return false;
  return true;
}

/** The item id iff the file list contains a real cover; otherwise "". */
export function coverArtIdFor(identifier: string, files: IaFile[]): string {
  return files.some(isRealCoverFile) ? identifier : "";
}

/** Quoted phrase for multi-word terms, bare term otherwise. */
function fieldTerm(field: string, value: string): string {
  const escaped = value.replace(/"/g, "");
  return /\s/.test(escaped) ? `${field}:("${escaped}")` : `${field}:(${escaped})`;
}

/**
 * A lone audio file running very long is a DJ mix / radio show, not an album.
 * Rejecting these keeps them from surfacing as one-track "albums".
 */
export function isSingleLongRecording(tracks: Array<{ durationSeconds: number }>): boolean {
  return tracks.length === 1 && (tracks[0]?.durationSeconds ?? 0) > MAX_SINGLE_TRACK_SECONDS;
}

/**
 * Archive.org's default search is full-text across the whole audio dump, so
 * "jazz" matches radio descriptions and random uploads. Constrain to music
 * collections and search the fields that actually carry genre/artist/title.
 */
export function buildSearchQuery(query: string): string {
  const q = query.trim();
  const collections = MUSIC_COLLECTIONS.join(" OR ");
  const termClause =
    q.length > 0
      ? `(${fieldTerm("subject", q)} OR ${fieldTerm("creator", q)} OR ${fieldTerm("title", q)})`
      : "";
  return [
    "mediatype:(audio)",
    `collection:(${collections})`,
    "NOT collection:(podcasts)",
    "NOT access-restricted-item:true",
    termClause,
  ]
    .filter((part) => part.length > 0)
    .join(" AND ");
}

function docToAlbum(doc: IaSearchDoc, coverArtId: string): Album {
  const id = doc.identifier;
  const title = normalizeTitle(id, first(doc.title) || id);
  const artist = first(doc.creator) || "Unknown Artist";
  const date = first(doc.date);
  const year = Number.parseInt(date.slice(0, 4), 10);
  return {
    id,
    title,
    artist,
    artistId: artistIdFor(artist),
    coverArtId,
    year: Number.isFinite(year) ? year : 0,
    // Live provider: track count unknown until the item is fetched.
    trackCount: 0,
    durationSeconds: 0,
  };
}

export function artistIdFor(artist: string): string {
  return `ar-${artist.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function formatRank(ext: string): number {
  const idx = FORMAT_PREFERENCE.indexOf(ext);
  return idx === -1 ? FORMAT_PREFERENCE.length : idx;
}

/** Preference between two renditions: lossless over lossy, original over derivative. */
function isPreferredRendition(candidate: IaFile, current: IaFile): boolean {
  const a = formatRank(extensionOf(candidate.name));
  const b = formatRank(extensionOf(current.name));
  if (a !== b) return a < b;
  return current.source === "derivative" && candidate.source !== "derivative";
}

/**
 * Identity of "the same recording". A file and its derivatives share the base
 * name (`Track.flac` -> `Track.mp3`), so collapsing whitespace/underscores and
 * dropping the extension maps renditions of one recording to one key.
 */
export function trackKeyOf(file: IaFile): string {
  const base = file.name.replace(/\.[^.]+$/, "");
  return base.replace(/[_\s]+/g, " ").trim().toLowerCase();
}

/**
 * One audio file per recording: collapses lossless+lossy pairs so an album
 * does not show each track twice. Returns files in the input's relative order.
 */
export function selectPreferredAudioFiles(files: IaFile[]): IaFile[] {
  const byKey = new Map<string, IaFile>();
  for (const file of files) {
    if (!AUDIO_EXTENSIONS.has(extensionOf(file.name))) continue;
    const key = trackKeyOf(file);
    const existing = byKey.get(key);
    if (!existing || isPreferredRendition(file, existing)) {
      byKey.set(key, file);
    }
  }
  return [...byKey.values()];
}

function filesToTracks(
  identifier: string,
  files: IaFile[],
  fallbackArtist: string,
  fallbackTitle: string,
  coverArtId: string,
): Track[] {
  const audioFiles = selectPreferredAudioFiles(files);
  // Stable ordering: by explicit track number when present, else by name.
  const sorted = [...audioFiles].sort((a, b) => {
    const ta = typeof a.track === "string" || typeof a.track === "number" ? Number.parseInt(String(a.track), 10) : Number.NaN;
    const tb = typeof b.track === "string" || typeof b.track === "number" ? Number.parseInt(String(b.track), 10) : Number.NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  return sorted.map((file, index) => {
    const suffix = extensionOf(file.name);
    const sizeNum = typeof file.size === "string" ? Number.parseInt(file.size, 10) : (file.size ?? 0);
    const explicitTitle = file.title && file.title.length > 0 ? file.title : undefined;
    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
    return {
      id: `${identifier}/${file.name}`,
      albumId: identifier,
      artistId: artistIdFor(fallbackArtist),
      title: explicitTitle ?? baseName ?? fallbackTitle,
      artist: fallbackArtist,
      album: fallbackTitle,
      trackNumber: Number.isFinite(Number.parseInt(String(file.track), 10)) ? Number.parseInt(String(file.track), 10) : index + 1,
      durationSeconds: parseLength(file.length),
      streamUrl: itemUrl(identifier, file.name),
      contentType: AUDIO_MIME[suffix] ?? "application/octet-stream",
      size: Number.isFinite(sizeNum) ? sizeNum : 0,
      coverArtId,
      suffix,
    };
  });
}

export function createArchiveOrgProvider(): Provider {
  return {
    id: "archive-org",

    async search(query: string, opts: SearchOpts): Promise<SearchResult> {
      const key = `ia:search:${query}:${opts.artistCount}:${opts.albumCount}:${opts.songCount}:${opts.artistOffset}:${opts.albumOffset}:${opts.songOffset}`;
      return cached(key, async () => {
        // Constrain by collection (music only) and search metadata fields
        // rather than Archive's whole-text index. See buildSearchQuery.
        const params = new URLSearchParams({
          q: buildSearchQuery(query),
          "fl[]": ["identifier", "title", "creator", "date", "downloads", "imagecount"],
          rows: String(Math.max(opts.artistCount, opts.albumCount, opts.songCount, 1) * 3),
          page: String(1 + Math.floor(Math.max(opts.albumOffset, opts.songOffset, opts.artistOffset) / 50)),
          output: "json",
        });
        const url = `${IA_SEARCH_URL}?${params.toString()}`;
        const data = await fetchJson<IaSearchResponse>(url);
        const docs = data.response?.docs ?? [];

        // imagecount counts every image including Archive's auto-generated
        // tile, so >= 2 implies the item carries a real image. The authoritative
        // per-file check happens in getAlbum.
        const albums: Album[] = docs.map((doc) =>
          docToAlbum(doc, (doc.imagecount ?? 0) >= 2 ? doc.identifier : ""),
        );
        const artistMap = new Map<string, Artist>();
        for (const album of albums) {
          const artistId = album.artistId;
          let artist = artistMap.get(artistId);
          if (!artist) {
            artist = { id: artistId, name: album.artist, albumIds: [] };
            artistMap.set(artistId, artist);
          }
          if (artist.albumIds.length < 50 && !artist.albumIds.includes(album.id)) {
            artist.albumIds.push(album.id);
          }
        }

        return {
          artists: [...artistMap.values()].slice(opts.artistOffset, opts.artistOffset + opts.artistCount),
          albums: albums.slice(opts.albumOffset, opts.albumOffset + opts.albumCount),
          tracks: [] as Track[],
        };
      });
    },

    async getAlbum(id: string): Promise<Album & { tracks: Track[] }> {
      return cached(`ia:item:${id}`, async () => {
        const data = await fetchJson<IaMetadata>(`${IA_METADATA_URL}/${encodeURIComponent(id)}`);
        if (!data.metadata) {
          throw new Error(`archive.org item not found: ${id}`);
        }
        const title = normalizeTitle(id, first(data.metadata.title) || id);
        const artist = first(data.metadata.creator) || "Unknown Artist";
        const date = first(data.metadata.date);
        const year = Number.parseInt(date.slice(0, 4), 10);
        const files = data.files ?? [];
        // Only surface a cover when the item really ships an operator image;
        // otherwise clients render a generated placeholder rather than
        // Archive.org's auto-generated waveform tile.
        const coverArtId = coverArtIdFor(id, files);
        const tracks = filesToTracks(id, files, artist, title, coverArtId);
        if (isSingleLongRecording(tracks)) {
          throw new Error(`item is a single long recording, not an album: ${id}`);
        }
        const duration = tracks.reduce((acc, t) => acc + t.durationSeconds, 0);
        return {
          id,
          title,
          artist,
          artistId: artistIdFor(artist),
          coverArtId,
          year: Number.isFinite(year) ? year : 0,
          trackCount: tracks.length,
          durationSeconds: duration,
          tracks,
        };
      });
    },

    async getStreamUrl(trackId: string): Promise<string> {
      // Track ids are "<identifier>/<filename>". Cover-art pseudo-ids get
      // resolved to archive.org's canonical image service, which always
      // serves a thumbnail (no file-list round-trip, no 404s).
      const sep = trackId.indexOf("/");
      if (sep <= 0) {
        throw new Error(`invalid track id: ${trackId}`);
      }
      const identifier = trackId.slice(0, sep);
      const fileName = trackId.slice(sep + 1);

      if (fileName === "__cover__") {
        return `https://archive.org/services/img/${encodeURIComponent(identifier)}`;
      }

      // Constructing the download URL directly keeps this cheap and cacheable;
      // a HEAD round-trip would double upstream latency per play.
      return itemUrl(identifier, fileName);
    },
  };
}

// Logging hook: archive.org failures are common and non-fatal; keep them at warn.
process.on("unhandledRejection", (reason) => {
  logger.debug({ reason }, "unhandled rejection (archive.org provider)");
});