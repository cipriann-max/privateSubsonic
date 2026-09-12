# agents.md — working conventions for privateSubsonic

How to work in this codebase. `README.md` covers the what; this covers the how.

## Who does what

- **The user runs git commits and terminal commands themselves.** The agent must not execute `git commit`, `git add`, builds, or other shell commands unless explicitly asked in the current request. Write files, fix code, and let the user run/commit.

## Layout

- npm **workspaces**: `server/` (Express 5, TS, ESM/NodeNext) and `web/` (Vite, React, Tailwind v4, shadcn/ui).
- All commands run from the repo root unless noted (`npm test`, `npm run dev`, …).
- Node >= 22 required (`engines` is enforced by package.json).

## Server conventions

- **Modules are ESM with `.js` import specifiers** (`import { x } from "./x.js"` pointing at `.ts` files). This is NodeNext, not a typo. Do not drop the extensions.
- **Env loading is anchored to APP_ROOT** (`src/config.ts` resolves the repo root from `import.meta.url`, then loads `.env.local`/`.env` from there). Never use `process.loadEnvFile` with a relative path — npm workspaces run scripts with the workspace dir as cwd, so relative env files silently don't load. Deployment target is **Coolify with railpack**: it runs `npm run build` then `npm start` from the root package.json and injects `PORT` (default 3000). Don't hardcode ports anywhere else.
- **Config** flows through `src/config.ts` (zod-validated env). Never read `process.env` elsewhere.
- **Logging** is pino (`src/logger.ts`). Never `console.*` — ESLint enforces it. Keep archive.org failures at `warn`/`debug`; they are common and non-fatal.
- **Auth**: all `/rest/*` handlers go through `authOrError` in `src/subsonic/router.ts`. Never add a route that bypasses `verifyCredentials` (the health endpoints live outside `/rest`).
- **Provider rule**: one interface, one implementation per source. Live in `src/subsonic/providers/<provider-id>.ts`, export `{ id, search, getAlbum, getStreamUrl }`, register in `providers/index.ts`. Do **not** build plugin loaders, manifests, or registries — a new provider is one import + one case. Track ids are `"<itemId>/<fileName>"`; cover-art pseudo-ids use the `__cover__` file marker.
- **No catalog DB in v0.1.** All catalog data is live from the provider through the LRU+TTL cache (`src/cache.ts`, `cached()` helper). Cache keys are prefixed per provider (`ia:…`). Do not persist catalog data to SQLite; `src/db.ts` exists only so later versions have the handle.
- **XML is not optional.** Every Subsonic endpoint must respond correctly for both `f=json` and `f=xml` (default). Use the helpers in `src/subsonic/responder.ts` (`sendOk`/`sendError` and the `*ChildAttrs` converters) instead of hand-building payloads.
- **Streaming** goes through `src/stream.ts` (proxy with Range support). Never redirect clients to archive.org URLs and never cache audio bytes.

## Web conventions

- Route alias is `@/` → `web/src/`. shadcn/ui components live in `src/components/ui` and are **generated** (`npx shadcn@latest add <component>` from `web/`) — never hand-edit them.
- The web app talks same-origin `/rest` via `src/lib/subsonic.ts`. Auth params (`u`, `t`, `s`) are attached per request; don't invent other auth paths.
- MD5 lives inline in `src/lib/subsonic.ts` on purpose (browser bundle, no dependency). Don't import `node:crypto` in `web/`.

## Testing

- Server tests are vitest in `server/test/*.test.ts`. Cover normalization helpers and auth logic; run `npm test` before declaring done.
- No browser tests yet; keep the player logic in small pure helpers when possible so it stays testable.

## Definition of done

1. `npm test` green.
2. `npm run build` clean for both workspaces.
3. `npm run lint` clean.
4. New endpoints verified with both `f=xml` and `f=json` (curl is fine).
5. Files end with a newline (POSIX).

## Known v0.1 sharp edges

- Archive.org metadata is wildly inconsistent; normalization aims for
  "browsing is tolerable". Improve `server/src/subsonic/providers/archive-org.ts`
  incrementally rather than redesigning the domain types.
- `getAlbumList2` maps list types onto search queries (`newest`→"the", etc.).
  This is a placeholder; refine later with real sort support.
- `getArtists` returns a flat "#" index — fine for clients, not a real index.