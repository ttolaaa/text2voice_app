#!/bin/sh
# Builds the Docker image from the *committed* code (git archive HEAD) and (re)starts the container,
# so the running app always matches the latest commit. Called by .githooks/post-commit and post-merge.
#
# Env options:
#   TEXT2VOICE_SKIP_DEPLOY=1   skip entirely (e.g. TEXT2VOICE_SKIP_DEPLOY=1 git commit ...)
#   PORT=8080                  host port to publish
set -eu

log() { echo "[text2voice] $*"; }

if [ "${TEXT2VOICE_SKIP_DEPLOY:-0}" = "1" ]; then
  log "TEXT2VOICE_SKIP_DEPLOY=1 - skipping deploy."
  exit 0
fi

cd "$(git rev-parse --show-toplevel)"

if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found - skipping auto-deploy (install Docker to enable it)."
  exit 0
fi
if ! docker info >/dev/null 2>&1; then
  log "Docker daemon is not running - skipping auto-deploy."
  exit 0
fi

GIT_COMMIT=$(git rev-parse --short HEAD)
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
APP_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n 1)
APP_VERSION=${APP_VERSION:-1.0.0}
export GIT_COMMIT BUILD_DATE APP_VERSION

log "Building image for commit $GIT_COMMIT (v$APP_VERSION)..."
git archive --format=tar HEAD | docker build \
  --build-arg APP_VERSION="$APP_VERSION" \
  --build-arg GIT_COMMIT="$GIT_COMMIT" \
  --build-arg BUILD_DATE="$BUILD_DATE" \
  -t "text2voice:$GIT_COMMIT" -t text2voice:latest -

log "Starting container..."
docker compose up -d --no-build --remove-orphans

log "Deployed $GIT_COMMIT -> http://localhost:${PORT:-8080}"
