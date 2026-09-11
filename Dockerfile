# privateSubsonic — single-container image (server + static web build)
# Bind-mount a data dir:  -v /your/host/dir:/app/data

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++ tini

# ---- deps ----
FROM base AS deps
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts || npm install --ignore-scripts

# ---- build ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY server server
COPY web web
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4533
# better-sqlite3 native module: install build tools once here (image builds from source
# only if a prebuilt binary is unavailable; keep python3/make/g++ for that path)
RUN apk add --no-cache python3 make g++ tini

COPY package.json ./
COPY server/package.json server/
RUN mkdir -p web/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/node_modules server/node_modules
# root workspace deps (e.g. concurrently) not needed at runtime; install server prod deps only
RUN cd server && npm install --omit=dev --ignore-scripts && cd .. && rm -rf server/node_modules/.cache

RUN mkdir -p /app/data
VOLUME /app/data
EXPOSE 4533

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/rest/ping.view?userName=healthcheck || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/dist/index.js"]