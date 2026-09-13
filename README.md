# privateSubsonic

A self-hosted server that makes the Internet Archive's free music browsable and
playable in any [OpenSubsonic](https://opensubsonic.net/) client.

One source. Stream it. Play it in a browser or an existing mobile client.

**Success criterion:** search for a Charlie Parker recording on your phone in
Symfonium, hit play, and it plays.

## What it does

- Queries [archive.org](https://archive.org) live — no catalog database, scoped
  to music collections (see *Search scope* below).
- Normalizes responses into artist/album/track shapes.
- Serves the [Subsonic API](https://www.subsonic.org/pages/api.jsp) so existing
  clients browse it as a normal library.
- Proxies audio bytes from archive.org to the client, with HTTP Range support.
- Ships a minimal web player so it's usable without installing anything.

### Explicitly out of scope for v0.1

Fingerprinting, tagging, uploads, local file libraries, caching beyond the
in-memory query cache, persistent indexing, radio, and multi-provider
aggregation. User accounts are supported (see *Users and first run*), but
per-user libraries, sharing, and roles beyond admin/user are not. All deferred —
the provider interface is kept clean so a second provider later is a new file,
not a refactor.

## The OpenSubsonic surface (v0.1)

`ping`, `getLicense`, `search3`, `getAlbum`, `getAlbumList2`, `getArtists`,
`getArtist`, `getMusicDirectory`, `getCoverArt`, `stream` / `download`, plus
cheap compatibility stubs (`getScanStatus`, `getPlaylists`). Auth uses the
Subsonic token scheme (salt + MD5); legacy plaintext `p=` and Basic auth are
accepted for picky clients.

## Quick start (dev)

```bash
npm install
cp .env.example .env       # optional; all values have defaults
npm run dev                # server on :3000, web on :5173 (proxied)
```

On first visit the app asks you to create the admin account (see *Users and
first run* below).

## Production (Docker / Coolify)

```bash
cp .env.example .env       # optional; all values have defaults
docker compose up -d --build
```

- Listens on the `PORT` env var (default **3000**; Coolify injects it automatically).
- Serves the built web UI from `web/dist`. In development this is skipped so the
  server never shadows Vite with a stale build (override with `SERVE_WEB=true`).
- Bind-mount a host directory to `/app/data` (compose does this at `./data`).
  This directory holds the SQLite file with the `users` table — persist it or
  you lose your accounts.
- Health check: `GET /healthz` (also `GET /rest/ping`).

### Coolify

Create a new resource from a **Dockerfile** (this repo), set optional env vars
from `.env.example`, and mount a volume at `/app/data`. That's it. Then open the
site and create the admin account — it is not read from the environment.

## Users and first run

There are no credentials in the environment. On first access the web UI detects
that no users exist and asks you to **create the admin account**; that admin can
then add and remove users and change passwords from the **Users** section of the
side nav. The `users` table in SQLite is the only source of authentication.

> **Breaking change:** `ADMIN_USER` / `ADMIN_PASSWORD` are ignored. Deployments
> upgrading from an earlier version must create the admin account in the browser
> once after deploying (existing data is unaffected — SQLite previously held no
> user data).

### Security notes

Passwords are stored as supplied, not hashed. The Subsonic token scheme is
`t = md5(password + salt)`, which the server must compute to authenticate any
Subsonic client, so a one-way hash would break every client. This is the same
posture the old `ADMIN_PASSWORD` env var had; treat the SQLite file as a secret
and restrict who can read it.

## Configuration

See [.env.example](.env.example) for every variable and its default. Most are
optional — `PORT` is the only one a host normally sets.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `LOG_LEVEL` | `info` | pino level |
| `DATABASE_PATH` | `data/privatesubsonic.db` | SQLite file (holds the `users` table) |
| `CACHE_MAX_ENTRIES` / `CACHE_TTL_SECONDS` | `500` / `3600` | in-memory query cache |
| `PROVIDER` | `archive-org` | provider id |
| `PROVIDER_TIMEOUT_MS` | `15000` | upstream timeout |

## Connecting a Subsonic client

| Field | Value |
| --- | --- |
| Server URL | `http://your-host:3000` (or your Coolify domain) |
| Username | a user created in the app |
| Password | that user's password (clients use the token scheme automatically) |

Tested with the standard flow: `ping` → `search3` → `getAlbum` → `stream`.

## Architecture

```
server/          Express 5 + TypeScript (ESM, NodeNext)
  src/subsonic/    protocol (auth, error codes), responder (JSON/XML), router
  src/subsonic/providers/   provider contract + archive-org implementation
  src/stream.ts    byte proxy with Range support
  src/cache.ts     LRU + TTL query cache (lru-cache)
  src/db.ts        SQLite bootstrap + users-table migration (better-sqlite3)
  src/users.ts     user store (source of truth for authentication)
  src/auth.ts      shared auth for /rest and /api (Subsonic token scheme)
  src/api.ts       JSON management API (setup, users)
web/             Vite + React + Tailwind v4 + shadcn/ui
  src/lib/subsonic.ts   OpenSubsonic client + /api management client
  src/App.tsx           setup → login → { search | users } with side nav
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

### Search scope (why results are music)

Archive.org's default search is full-text across its entire audio dump, which
surfaces talk radio and random uploads. Searches are constrained to music
collections — `georgeblood` (Great 78 Project), `etree` (Live Music Archive)
and `audio_music` — require `mediatype:audio`, exclude podcasts and
lending-restricted items, and match the `subject`/`creator`/`title` fields
instead of the whole-text index (`buildSearchQuery` in
`server/src/subsonic/providers/archive-org.ts`). Items whose only audio file
runs longer than 30 minutes are treated as DJ mixes / radio shows and hidden.

Cover art is advertised only when an item really contains an operator-supplied
image; otherwise the web player renders a generated placeholder derived from
the artist name rather than Archive.org's auto-generated waveform tile.

Archive items keep a lossless original next to generated lossy derivatives of
the same recording, so each recording is listed once — preferring lossless
(`flac`, `wav`, …) over lossy and originals over derivatives
(`selectPreferredAudioFiles`). This is why an album with both `.flac` and
`.mp3` files does not show every track twice.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | server + web concurrently (dev) |
| `npm run build` | build server (`tsc`) and web (`vite build`) |
| `npm start` | run the built server (what Coolify/railpack executes) |
| `npm test` | server unit tests (vitest) |
| `npm run lint` | eslint for both workspaces |

See [agents.md](agents.md) for working conventions in this codebase.