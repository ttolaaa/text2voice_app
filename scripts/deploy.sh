#!/bin/sh
# Builds the Docker images from the *committed* code (git archive HEAD) and (re)starts the containers,
# so the running app always matches the latest commit. Called by .githooks/post-commit and post-merge.
#
# Env options:
#   TEXT2VOICE_SKIP_DEPLOY=1   skip entirely (e.g. TEXT2VOICE_SKIP_DEPLOY=1 git commit ...)
#   TEXT2VOICE_GPU=1           also apply docker-compose.gpu.yml (NVIDIA GPU for My Voice)
#   PORT=8080                  host port to publish
set -eu

log() { echo "[text2voice] $*"; }

if [ "${TEXT2VOICE_SKIP_DEPLOY:-0}" = "1" ]; then
  log "TEXT2VOICE_SKIP_DEPLOY=1 - skipping deploy."
  exit 0
fi

REPO=$(git rev-parse --show-toplevel)
cd "$REPO"

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

COMPOSE_FILES="-f docker-compose.yml"
[ "${TEXT2VOICE_GPU:-0}" = "1" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.gpu.yml"

# Build from a clean export of HEAD so uncommitted edits never reach the running containers.
SNAPSHOT=$(mktemp -d)
trap 'rm -rf "$SNAPSHOT"' EXIT
git archive --format=tar HEAD | tar -x -C "$SNAPSHOT"

log "Building images for commit $GIT_COMMIT (v$APP_VERSION)..."
# shellcheck disable=SC2086
(cd "$SNAPSHOT" && docker compose -p text2voice $COMPOSE_FILES build)

log "Starting containers..."
# shellcheck disable=SC2086
docker compose -p text2voice $COMPOSE_FILES up -d --no-build --remove-orphans

log "Deployed $GIT_COMMIT -> http://localhost:${PORT:-8080}"
