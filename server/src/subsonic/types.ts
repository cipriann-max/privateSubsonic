/**
 * Core domain shapes shared by the provider interface and the OpenSubsonic
 * API layer. Normalization targets: keep these minimal and stable.
 */

export interface Track {
  /** Stable id, opaque to clients. For archive.org: "<item-id>/<file-name>" */
  id: string;
  /** Parent album id (archive.org item id). */
  albumId: string;
  /** Parent artist id. */
  artistId: string;
  title: string;
  artist: string;
  album: string;
  /** Track position within the album, 1-based; 0 when unknown. */
  trackNumber: number;
  durationSeconds: number;
  /** Direct streamable audio URL (archive.org file URL). */
  streamUrl: string;
  /** Mime type of the audio file, e.g. "audio/mpeg". */
  contentType: string;
  /** Audio file size in bytes, 0 when unknown. */
  size: number;
  /** Cover art reference id; typically the album id. Empty string when none. */
  coverArtId: string;
  /** File suffix without dot, e.g. "mp3". */
  suffix: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  /** Cover art reference id; empty string when none. */
  coverArtId: string;
  year: number;
  trackCount: number;
  durationSeconds: number;
}

export interface Artist {
  id: string;
  name: string;
  /** Album ids known for this artist (may be incomplete with live providers). */
  albumIds: string[];
}

export interface SearchResult {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}

export interface SearchOpts {
  artistCount: number;
  albumCount: number;
  songCount: number;
  artistOffset: number;
  albumOffset: number;
  songOffset: number;
}

export interface Provider {
  /** Stable provider id, e.g. "archive-org". */
  readonly id: string;
  search(query: string, opts: SearchOpts): Promise<SearchResult>;
  getAlbum(id: string): Promise<Album & { tracks: Track[] }>;
  /** Returns a direct, upstream streamable URL for the track id. */
  getStreamUrl(trackId: string): Promise<string>;
}