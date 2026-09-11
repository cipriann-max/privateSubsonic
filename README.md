# privateSubsonic

A self-hosted server that makes the Internet Archive's free music browsable and
playable in any [OpenSubsonic](https://opensubsonic.net/) client.

One source. Stream it. Play it in a browser or an existing mobile client.

**Success criterion:** search for a Charlie Parker recording on your phone in
Symfonium, hit play, and it plays.

## What it does

- Queries [archive.org](https://archive.org) live — no catalog database.
- Normalizes responses into artist/album/track shapes.
- Serves the [Subsonic API](https://www.subsonic.org/pages/api.jsp) so existing
  clients browse it as a normal library.
- Proxies audio bytes from archive.org to the client, with HTTP Range support.
- Ships a minimal web player so it's usable without installing anything.

### Explicitly out of scope for v0.1

Fingerprinting, tagging, uploads, local file libraries, caching beyond the
in-memory query cache, persistent indexing, radio, multi-provider aggregation,
and user accounts beyond a single admin. All deferred — the provider interface
is kept clean so a second provider later is a new file, not a refactor.

## The OpenSubsonic surface (v0.1)

`ping`, `getLicense`, `search3`, `getAlbum`, `getAlbumList2`, `getArtists`,
`getArtist`, `getMusicDirectory`, `getCoverArt`, `stream` / `download`, plus
cheap compatibility stubs (`getScanStatus`, `getPlaylists`). Auth uses the
Subsonic token scheme (salt + MD5); legacy plaintext `p=` and Basic auth are
accepted for picky clients.

## Quick start (dev)

```bash
npm install
cp .env.example .env       # adjust credentials
npm run dev                # server on :4533, web on :5173 (proxied)
```

## Production (Docker / Coolify)

```bash
cp .env.example .env       # set ADMIN_PASSWORD and AUTH_SALT
docker compose up -d --build
```

- Listens on port **4533**.
- Bind-mount a host directory to `/app/data` (compose does this at `./data`).
- The SQLite file is bootstrapped at startup but unused in v0.1; later
  versions may persist state there without changing deployment.
- Health check: `GET /healthz` (also `GET /rest/ping`).

### Coolify

Create a new resource from a **Dockerfile** (this repo), set env vars from
`.env.example`, and mount a volume at `/app/data`. That's it.

## Configuration

See [.env.example](.env.example) for every variable and its default:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4533` | HTTP listen port |
| `LOG_LEVEL` | `info` | pino level |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / `changeme` | single admin credential |
| `DATABASE_PATH` | `data/privatesubsonic.db` | SQLite file (unused in v0.1) |
| `CACHE_MAX_ENTRIES` / `CACHE_TTL_SECONDS` | `500` / `3600` | in-memory query cache |
| `PROVIDER` | `archive-org` | provider id |
| `PROVIDER_TIMEOUT_MS` | `15000` | upstream timeout |

## Connecting a Subsonic client

| Field | Value |
| --- | --- |
| Server URL | `http://your-host:4533` |
| Username | `ADMIN_USER` |
| Password | `ADMIN_PASSWORD` (clients use the token scheme automatically) |

Tested with the standard flow: `ping` → `search3` → `getAlbum` → `stream`.

## Architecture

```
server/          Express 5 + TypeScript (ESM, NodeNext)
  src/subsonic/    protocol (auth, error codes), responder (JSON/XML), router
  src/subsonic/providers/   provider contract + archive-org implementation
  src/stream.ts    byte proxy with Range support
  src/cache.ts     LRU + TTL query cache (lru-cache)
  src/db.ts        SQLite bootstrap (better-sqlite3, unused in v0.1)
web/             Vite + React + Tailwind v4 + shadcn/ui
  src/lib/subsonic.ts   OpenSubsonic client (salt+MD5 token auth)
  src/App.tsx           login → search → album → play
```

### Provider contract

One interface, one implementation. Adding a provider (e.g. Musopen) is a new
module in `server/src/subsonic/providers/` exporting:

```ts
search(query, opts) -> results
getAlbum(id) -> album with tracks
getStreamUrl(trackId) -> url
```

Then register it in `providers/index.ts`. No plugin loader, no manifest.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | server + web concurrently (dev) |
| `npm run build` | build server (`tsc`) and web (`vite build`) |
| `npm test` | server unit tests (vitest) |
| `npm run lint` | eslint for both workspaces |

See [agents.md](agents.md) for working conventions in this codebase.