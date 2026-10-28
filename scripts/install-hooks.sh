#!/bin/sh
# Enable the repository's git hooks (auto-deploy on commit/pull, tests before commit).
set -eu
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/* scripts/*.sh 2>/dev/null || true
echo "Git hooks enabled (core.hooksPath=.githooks)."
