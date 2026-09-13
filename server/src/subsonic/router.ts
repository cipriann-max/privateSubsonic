import type { Request, Response } from "express";
import { Router } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { SUBSONIC_ERROR, type SubsonicError } from "./protocol.js";
import { authenticate } from "../auth.js";
import type { User } from "../users.js";
import {
  albumChildAttrs,
  artistChildAttrs,
  sendError,
  sendOk,
  trackChildAttrs,
} from "./responder.js";
import { getProvider } from "./providers/index.js";
import type { Provider } from "./types.js";

/**
 * The OpenSubsonic surface for v0.1:
 * ping, getLicense, search3, getAlbum, getAlbumList2, getArtists,
 * getMusicDirectory, getCoverArt, stream (+ getArtist, getArtistInfo2,
 * getScanStatus, getPlaylists as cheap compatibility stubs).
 */

interface ReqContext {
  provider: Provider;
  /** The authenticated user for this request (resolved from the users table). */
  user: User;
}

type AuthedRequest = Request;

function authOrError(handler: (req: AuthedRequest, res: Response, ctx: ReqContext) => Promise<void> | void) {
  return async (req: AuthedRequest, res: Response) => {
    const outcome = authenticate(req.query, req.body, req.headers);
    if (!outcome.ok) {
      sendError(res, req as never, outcome.error);
      return;
    }
    const ctx: ReqContext = { provider: getProvider(config.provider), user: outcome.user };
    await handler(req, res, ctx);
  };
}

function notImplemented(res: Response, req: Request, name: string): void {
  sendError(res, req, {
    code: SUBSONIC_ERROR.GENERIC,
    message: `Endpoint '${name}' is not implemented in privateSubsonic v0.1.`,
  });
}

export function subsonicRouter(): Router {
  const router = Router();

  const ping = authOrError((req, res) => {
    sendOk(res, req);
  });
  router.get("/ping", ping);
  router.get("/ping.view", ping);

  const getLicense = authOrError((req, res, ctx) => {
    sendOk(res, req, { license: { valid: true, email: ctx.user.username, licenseExpires: "2999-12-31T00:00:00Z" } });
  });
  router.get("/getLicense", getLicense);
  router.get("/getLicense.view", getLicense);

  const search3 = authOrError(async (req, res, ctx) => {
    const query = typeof req.query.query === "string" ? req.query.query : "";
    const opts = {
      artistCount: toInt(req.query.artistCount, 20),
      albumCount: toInt(req.query.albumCount, 20),
      songCount: toInt(req.query.songCount, 20),
      artistOffset: toInt(req.query.artistOffset, 0),
      albumOffset: toInt(req.query.albumOffset, 0),
      songOffset: toInt(req.query.songOffset, 0),
    };
    // Subsonic quirk: search3 with an empty query should return popular/newest
    // content. With a live provider we treat it as a broad browse query.
    const q = query === "" ? "the" : query;
    const results = await ctx.provider.search(q, opts);
    sendOk(res, req, {
      searchResult3: {
        artist: results.artists.map(artistChildAttrs),
        album: results.albums.map(albumChildAttrs),
        song: results.tracks.map(trackChildAttrs),
      },
    });
  });
  router.get("/search3", search3);
  router.get("/search3.view", search3);

  const getAlbum = authOrError(async (req, res, ctx) => {
    const id = requireId(req);
    if (id === null) {
      sendError(res, req, { code: SUBSONIC_ERROR.MISSING_PARAM, message: "Required parameter 'id' is missing." });
      return;
    }
    try {
      const album = await ctx.provider.getAlbum(id);
      sendOk(res, req, {
        album: {
          ...albumChildAttrs(album),
          created: new Date().toISOString(),
          song: album.tracks.map(trackChildAttrs),
        },
      });
    } catch (err) {
      logger.warn({ err, albumId: id }, "getAlbum failed");
      sendError(res, req, { code: SUBSONIC_ERROR.NOT_FOUND, message: "Album not found." });
    }
  });
  router.get("/getAlbum", getAlbum);
  router.get("/getAlbum.view", getAlbum);

  const getAlbumList2 = authOrError(async (req, res, ctx) => {
    const type = typeof req.query.type === "string" ? req.query.type : "newest";
    const size = toInt(req.query.size, 10);
    const offset = toInt(req.query.offset, 0);
    // Map list types onto search queries; "newest"/"alphabeticalByName" behave
    // sensibly against Archive.org's advanced search.
    const query = type === "alphabeticalByName" ? "" : type === "random" ? "jazz" : "the";
    const results = await ctx.provider.search(query, {
      artistCount: 0,
      albumCount: size,
      songCount: 0,
      artistOffset: 0,
      albumOffset: offset,
      songOffset: 0,
    });
    sendOk(res, req, { albumList2: { album: results.albums.map(albumChildAttrs) } });
  });
  router.get("/getAlbumList2", getAlbumList2);
  router.get("/getAlbumList2.view", getAlbumList2);

  const getArtists = authOrError(async (req, res, ctx) => {
    // Live provider: derive the artist index from a broad search.
    const results = await ctx.provider.search("", { artistCount: 100, albumCount: 0, songCount: 0, artistOffset: 0, albumOffset: 0, songOffset: 0 });
    const artists = results.artists.map(artistChildAttrs);
    sendOk(res, req, {
      artists: {
        ignoredArticles: "The El La Los Las Le Les",
        index: [
          { name: "#", artist: artists },
        ],
      },
    });
  });
  router.get("/getArtists", getArtists);
  router.get("/getArtists.view", getArtists);

  const getArtist = authOrError(async (req, res, ctx) => {
    const id = requireId(req);
    if (id === null) {
      sendError(res, req, { code: SUBSONIC_ERROR.MISSING_PARAM, message: "Required parameter 'id' is missing." });
      return;
    }
    try {
      const results = await ctx.provider.search(idToQuery(id), {
        artistCount: 1,
        albumCount: 50,
        songCount: 0,
        artistOffset: 0,
        albumOffset: 0,
        songOffset: 0,
      });
      const artist = results.artists[0] ?? { id, name: idToQuery(id), albumIds: results.albums.map((a) => a.id) };
      sendOk(res, req, {
        artist: {
          ...artistChildAttrs(artist),
          album: results.albums.map(albumChildAttrs),
        },
      });
    } catch (err) {
      logger.warn({ err, artistId: id }, "getArtist failed");
      sendError(res, req, { code: SUBSONIC_ERROR.NOT_FOUND, message: "Artist not found." });
    }
  });
  router.get("/getArtist", getArtist);
  router.get("/getArtist.view", getArtist);

  const getMusicDirectory = authOrError(async (req, res, ctx) => {
    const id = requireId(req);
    if (id === null) {
      sendError(res, req, { code: SUBSONIC_ERROR.MISSING_PARAM, message: "Required parameter 'id' is missing." });
      return;
    }
    try {
      // Directory ids double as album ids (archive.org items).
      const album = await ctx.provider.getAlbum(id);
      sendOk(res, req, {
        directory: {
          id,
          name: album.title,
          parent: album.artistId,
          child: album.tracks.map(trackChildAttrs),
        },
      });
    } catch {
      // Treat the id as an artist directory.
      const results = await ctx.provider.search(idToQuery(id), {
        artistCount: 1,
        albumCount: 50,
        songCount: 0,
        artistOffset: 0,
        albumOffset: 0,
        songOffset: 0,
      });
      sendOk(res, req, {
        directory: {
          id,
          name: idToQuery(id),
          child: results.albums.map(albumChildAttrs),
        },
      });
    }
  });
  router.get("/getMusicDirectory", getMusicDirectory);
  router.get("/getMusicDirectory.view", getMusicDirectory);

  const getCoverArt = authOrError(async (req, res, ctx) => {
    const id = requireId(req);
    if (id === null) {
      sendError(res, req, { code: SUBSONIC_ERROR.MISSING_PARAM, message: "Required parameter 'id' is missing." });
      return;
    }
    try {
      const url = await ctx.provider.getStreamUrl(coverArtIdToStreamId(id));
      res.redirect(302, url);
    } catch (err) {
      logger.warn({ err, coverArtId: id }, "getCoverArt failed");
      sendError(res, req, { code: SUBSONIC_ERROR.NOT_FOUND, message: "Cover art not found." });
    }
  });
  router.get("/getCoverArt", getCoverArt);
  router.get("/getCoverArt.view", getCoverArt);

  const stream = authOrError(async (req, res, ctx) => {
    const id = requireId(req);
    if (id === null) {
      sendError(res, req, { code: SUBSONIC_ERROR.MISSING_PARAM, message: "Required parameter 'id' is missing." });
      return;
    }
    try {
      const upstream = await ctx.provider.getStreamUrl(id);
      // Proxy bytes rather than redirect so clients never see upstream URLs
      // and range requests flow through a single origin.
      await proxyStream(upstream, req, res);
    } catch (err) {
      logger.warn({ err, trackId: id }, "stream failed");
      sendError(res, req, { code: SUBSONIC_ERROR.NOT_FOUND, message: "Track not found." });
    }
  });
  router.get("/stream", stream);
  router.get("/stream.view", stream);
  router.get("/download", stream);
  router.get("/download.view", stream);

  // Cheap compatibility stubs that unblock picky clients.
  const getArtistInfo2 = authOrError((req, res) => {
    notImplemented(res, req, "getArtistInfo2");
  });
  router.get("/getArtistInfo2", getArtistInfo2);
  router.get("/getArtistInfo2.view", getArtistInfo2);

  const getScanStatus = authOrError((req, res) => {
    sendOk(res, req, { scanStatus: { scanning: false, count: 0 } });
  });
  router.get("/getScanStatus", getScanStatus);
  router.get("/getScanStatus.view", getScanStatus);

  const getPlaylists = authOrError((req, res) => {
    sendOk(res, req, { playlists: { playlist: [] } });
  });
  router.get("/getPlaylists", getPlaylists);
  router.get("/getPlaylists.view", getPlaylists);

  // Catch-all for anything else — explicit error instead of a 404 HTML page.
  router.use((req, res) => {
    sendError(res, req as never, {
      code: SUBSONIC_ERROR.GENERIC,
      message: `Unknown Subsonic endpoint: ${req.path}`,
    });
  });

  return router;
}

function proxyStream(upstream: string, req: AuthedRequest, res: Response): Promise<void> {
  // Implemented in ../stream.ts to keep this file readable.
  return import("../stream.js").then((m) => m.proxyStream(upstream, req, res));
}

function toInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function requireId(req: AuthedRequest): string | null {
  const id = req.query.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Archive.org ids are the search terms for artist-ish lookups. */
function idToQuery(id: string): string {
  // Strip known prefixes like "ar-", keep raw item ids as queries.
  return id.replace(/^ar-/, "").replace(/[-_]/g, " ").trim() || id;
}

/** Cover art ids are album ids; derive the file id for the item's first image. */
function coverArtIdToStreamId(id: string): string {
  // getStreamUrl splits on "/": "<identifier>/__cover__" resolves to the
  // item's canonical image via archive.org services/img.
  return `${id}/__cover__`;
}