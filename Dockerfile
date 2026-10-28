# syntax=docker/dockerfile:1

# ---- Stage 1: download the pinned, checksum-verified neural voice runtime + model ----
# Only depends on the lock file, so Docker caches this layer across ordinary commits.
FROM node:22-alpine AS assets
WORKDIR /src
COPY scripts/fetch-assets.mjs scripts/assets.lock.json ./scripts/
RUN ASSETS_DIR=/assets node scripts/fetch-assets.mjs

# ---- Stage 2: the app (dependency-free Node server + static site) ----
FROM node:22-alpine

ARG APP_VERSION=1.0.0
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="text2voice" \
      org.opencontainers.image.description="Storyteller - expressive text to voice web app" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}"

ENV NODE_ENV=production \
    PORT=8080 \
    PUBLIC_DIR=/app/public \
    ASSETS_DIR=/app/assets

WORKDIR /app
COPY --from=assets /assets ./assets
COPY package.json ./
COPY server ./server
COPY public ./public

# Stamp the image with the commit it was built from; the app polls this to detect new deployments.
RUN printf '{"version":"%s","commit":"%s","builtAt":"%s"}\n' "$APP_VERSION" "$GIT_COMMIT" "$BUILD_DATE" \
      > /app/public/version.json

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/index.js"]
