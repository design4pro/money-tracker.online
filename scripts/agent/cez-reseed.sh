#!/usr/bin/env bash
# Reset the dev server's D1 seed (scripts/seed/seed.mjs --force) on this worktree's port.
# For an agent that changed a migration or wants a clean fixture between ladder passes.
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

PORT=$(bash "$(dirname "$0")/cez-port.sh" current) || die "no dev server port pinned; run cez-setup.sh first"
heartbeat
clean_env -- node scripts/seed/seed.mjs --force --url "http://127.0.0.1:$PORT"
clean_env -- node scripts/seed/verify.mjs --url "http://127.0.0.1:$PORT"
