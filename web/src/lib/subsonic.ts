/**
 * Minimal OpenSubsonic client for the bundled web player.
 * Talks to same-origin /rest (dev: proxied by Vite; prod: served by Express).
 * Auth: salt + md5 token scheme, credentials supplied by the operator in the UI.
 */

// MD5 is required by the Subsonic token scheme; a small inline implementation
// avoids pulling in a dependency and works in the browser bundle.
/* eslint-disable */

function md5(input: string): string {
  // RFC 1321 MD5 (public-domain style implementation, condensed).
  function toUtf8Bytes(str: string): Uint8Array {
    return new TextEncoder().encode(str);
  }
  function rotl(n: number, b: number): number {
    return (n << b) | (n >>> (32 - b));
  }
  function add(a: number, b: number): number {
    return (a + b) | 0;
  }
  const K = new Int32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);
  const S = new Int32Array([
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]);

  const bytes = toUtf8Bytes(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const chunks = padded.length / 64;
  for (let i = 0; i < chunks; i++) {
    const m = new Int32Array(16);
    const off = i * 64;
    for (let j = 0; j < 16; j++) m[j] = view.getInt32(off + j * 4, true);
    let A = a, B = b, C = c, D = d;
    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
      if (j < 16) { f = (B & C) | (~B & D); g = j; }
      else if (j < 32) { f = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { f = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { f = C ^ (B | ~D); g = (7 * j) % 16; }
      const tmp = D; D = C; C = B;
      f = add(f, add(A, K[j]));
      const s = S[j];
      B = add(B, add((f << s) | (f >>> (32 - s)), m[g]!));
      A = tmp;
    }
    a = add(a, A); b = add(b, B); c = add(c, C); d = add(d, D);
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setInt32(0, a, true);
  out.setInt32(4, b, true);
  out.setInt32(8, c, true);
  out.setInt32(12, d, true);
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(out.getUint8(i).toString(16).padStart(2, "0"));
  }
  return hex.join("");
}
/* eslint-enable */

export { md5 };

export interface SubsonicCreds {
  username: string;
  password: string;
}

export interface SubsonicClientOptions extends SubsonicCreds {
  baseUrl?: string;
}

export class SubsonicClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private clientName = "privatesubsonic-web";

  constructor(opts: SubsonicClientOptions) {
    this.baseUrl = (opts.baseUrl ?? "").replace(/\/$/, "");
    this.username = opts.username;
    this.password = opts.password;
  }

  private signedParams(extra: Record<string, string> = {}): URLSearchParams {
    const salt = Math.random().toString(36).slice(2, 12);
    const token = md5(this.password + salt);
    const params = new URLSearchParams({
      u: this.username,
      t: token,
      s: salt,
      v: "1.16.1",
      c: this.clientName,
      f: "json",
      ...extra,
    });
    return params;
  }

  async get<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = `${this.baseUrl}/rest/${endpoint}?${this.signedParams(params).toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`${endpoint} failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as Record<string, any>;
    const envelope = body["subsonic-response"];
    if (!envelope || envelope.status !== "ok") {
      const err = envelope?.error;
      throw new Error(`subsonic error ${err?.code ?? "?"}: ${err?.message ?? "unknown"}`);
    }
    return envelope as T;
  }

  /** URL for streaming a track (auth in query string, as clients do). */
  streamUrl(trackId: string): string {
    return `${this.baseUrl}/rest/stream?${this.signedParams({ id: trackId }).toString()}`;
  }

  coverArtUrl(coverArtId: string, size = 300): string {
    return `${this.baseUrl}/rest/getCoverArt?${this.signedParams({ id: coverArtId, size: String(size) }).toString()}`;
  }

  async ping(): Promise<boolean> {
    try {
      await this.get("ping");
      return true;
    } catch {
      return false;
    }
  }

  async search3(query: string): Promise<SearchResult3> {
    const res = await this.get<{ searchResult3: SearchResult3 }>("search3", {
      query,
      artistCount: "20",
      albumCount: "20",
      songCount: "50",
    });
    return res.searchResult3;
  }

  async getAlbum(id: string): Promise<Album> {
    const res = await this.get<{ album: Album }>("getAlbum", { id });
    return res.album;
  }
}

export interface Artist {
  id: string;
  name: string;
  albumCount?: number;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  coverArt?: string;
  year?: number;
  songCount?: number;
  duration?: number;
  song?: Track[];
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  duration?: number;
  track?: number;
  contentType?: string;
  suffix?: string;
}

export interface SearchResult3 {
  artist?: Artist[];
  album?: Album[];
  song?: Track[];
}