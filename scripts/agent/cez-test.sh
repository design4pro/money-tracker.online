#!/usr/bin/env bash
# Run vitest on named files under a scrubbed environment. Allowlisted for agent steps, so
# the argument space is closed: only paths inside the repo's test roots, no flags.
#
#   scripts/agent/cez-test.sh <file.test.ts> [...]
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

[ $# -gt 0 ] || die "usage: cez-test.sh <test file> [...]"
for f in "$@"; do
  case "$f" in
    -*) die "flags are not accepted: $f" ;;
    *..*) die "path not allowed: $f" ;;
    src/*|server/*|scripts/*) ;;
    *) die "path outside the test roots: $f" ;;
  esac
  [ -f "$f" ] || die "no such file: $f"
done

heartbeat
clean_env -- pnpm exec vitest run "$@"
