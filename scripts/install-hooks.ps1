# Enable the repository's git hooks (auto-deploy on commit/pull, tests before commit).
$ErrorActionPreference = 'Stop'
Set-Location (git rev-parse --show-toplevel)
git config core.hooksPath .githooks
Write-Host 'Git hooks enabled (core.hooksPath=.githooks).'
