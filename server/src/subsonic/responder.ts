import type { Request, Response } from "express";
import { XMLBuilder } from "fast-xml-parser";
import type { SubsonicError } from "./protocol.js";

/**
 * OpenSubsonic response envelope.
 * JSON shape:  { "subsonic-response": { status, version, ..., <payload> } }
 * XML shape:   <subsonic-response xmlns="..." status="ok" version="...">...
 * Clients pick via the `f` request parameter: json | xml (default) | jsonp.
 */

export const SUBSONIC_API_VERSION = "1.16.1";
export const SUBSONIC_XML_NAMESPACE = "http://subsonic.org/restapi";

const xmlBuilder = new XMLBuilder({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  format: true,
  indentBy: "  ",
  // Render booleans as explicit `="true"`/`="false"` attributes; Subsonic
  // clients expect attribute values, not bare attribute names.
  suppressBooleanAttributes: false,
});

export type ResponseFormat = "json" | "xml" | "jsonp";

export function pickFormat(req: Request): ResponseFormat {
  const f = typeof req.query.f === "string" ? req.query.f.toLowerCase() : "xml";
  if (f === "json") return "json";
  if (f === "jsonp") return "jsonp";
  return "xml";
}

type Attr = Record<string, unknown>;
interface PayloadNode {
  attrs: Attr;
  children: Record<string, unknown>;
}

function toNode(payload: Attr): PayloadNode {
  const attrs: Attr = {};
  const children: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value) && isAttrsOnly(value as Attr)) {
      attrs[key] = value;
    } else {
      children[key] = value;
    }
  }
  return { attrs, children };
}

/**
 * Heuristic for JSON -> XML conversion: plain objects that contain only
 * scalars (or arrays of scalars) are treated as XML attributes; anything
 * nested becomes child elements. Endpoint handlers may override per-call.
 */
function isAttrsOnly(value: Record<string, unknown>): boolean {
  return Object.values(value).every((v) => typeof v !== "object" || v === null);
}

function buildSubsonicJson(
  status: "ok" | "failed",
  payload: Attr,
  extras: Attr = {},
): Record<string, unknown> {
  return {
    "subsonic-response": {
      status,
      version: SUBSONIC_API_VERSION,
      type: "privatesubsonic",
      serverVersion: "0.1.0",
      openSubsonic: true,
      ...extras,
      ...payload,
    },
  };
}

function buildSubsonicXml(
  status: "ok" | "failed",
  payload: Attr,
  extras: Attr = {},
): string {
  const node = toNode(payload);
  const merged = { ...extras, ...node.attrs };
  const body: Record<string, unknown> = {
    "@_xmlns": SUBSONIC_XML_NAMESPACE,
    "@_status": status,
    "@_version": SUBSONIC_API_VERSION,
    "@_type": "privatesubsonic",
    "@_serverVersion": "0.1.0",
  };
  for (const [key, value] of Object.entries(merged)) {
    // Optional attributes are expressed as `undefined`; skip them entirely so
    // the XML builder never emits `key="undefined"` for absent values.
    if (value === undefined) continue;
    body[`@_${key}`] = value;
  }
  for (const [key, value] of Object.entries(node.children)) {
    body[key] = value;
  }
  return xmlBuilder.build({ "subsonic-response": body });
}

export interface SendOptions {
  /** Attributes/fields for the response body element (e.g. { artists: [...] }). */
  payload?: Attr;
  /** Extra top-level envelope attributes (e.g. scanStatus). */
  extras?: Attr;
  /** HTTP status for error responses; default 200 per Subsonic convention. */
  httpStatus?: number;
}

export function sendOk(res: Response, req: Request, payload: Attr = {}, extras: Attr = {}): void {
  const format = pickFormat(req);
  if (format === "json" || format === "jsonp") {
    const json = buildSubsonicJson("ok", payload, extras);
    if (format === "jsonp") {
      const callback = sanitizeCallback(req.query.callback);
      res.type("text/javascript").send(`${callback}(${JSON.stringify(json)});`);
    } else {
      res.json(json);
    }
  } else {
    res.type("application/xml").send(buildSubsonicXml("ok", payload, extras));
  }
}

export function sendError(res: Response, req: Request, error: SubsonicError, httpStatus = 200): void {
  const payload = { error: { code: error.code, message: error.message } };
  const format = pickFormat(req);
  if (format === "json" || format === "jsonp") {
    const json = buildSubsonicJson("failed", payload);
    if (format === "jsonp") {
      const callback = sanitizeCallback(req.query.callback);
      res.type("text/javascript").status(httpStatus).send(`${callback}(${JSON.stringify(json)});`);
    } else {
      res.status(httpStatus).json(json);
    }
  } else {
    res.type("application/xml").status(httpStatus).send(buildSubsonicXml("failed", payload));
  }
}

function sanitizeCallback(raw: unknown): string {
  const name = typeof raw === "string" ? raw : "";
  // Restrict to a valid JS identifier to prevent response splitting.
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : "callback";
}

/**
 * Convert domain objects into Subsonic child-element attribute objects.
 * Kept here so endpoints stay thin and JSON/XML stay consistent.
 */
export function trackChildAttrs(t: {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  album: string;
  albumId: string;
  trackNumber: number;
  durationSeconds: number;
  contentType: string;
  size: number;
  coverArtId: string;
  suffix: string;
}): Attr {
  return {
    id: t.id,
    parent: t.albumId,
    isDir: false,
    title: t.title,
    artist: t.artist,
    artistId: t.artistId,
    album: t.album,
    albumId: t.albumId,
    track: t.trackNumber || undefined,
    duration: t.durationSeconds || undefined,
    contentType: t.contentType,
    size: t.size || undefined,
    coverArt: t.coverArtId || undefined,
    suffix: t.suffix || undefined,
    type: "music",
    played: undefined,
  };
}

export function albumChildAttrs(a: {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  coverArtId: string;
  year: number;
  trackCount: number;
  durationSeconds: number;
}): Attr {
  return {
    id: a.id,
    title: a.title,
    artist: a.artist,
    artistId: a.artistId,
    coverArt: a.coverArtId || undefined,
    year: a.year || undefined,
    songCount: a.trackCount,
    duration: a.durationSeconds,
    isDir: true,
  };
}

export function artistChildAttrs(a: { id: string; name: string; albumIds: string[] }): Attr {
  return {
    id: a.id,
    name: a.name,
    albumCount: a.albumIds.length,
  };
}