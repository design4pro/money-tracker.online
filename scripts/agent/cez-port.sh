#!/usr/bin/env bash
# Dev-server port for one worktree, from the pool Playwright reserves for automation
# (3010-3020, playwright.config.ts). The pool starts at 3011 because 3010 is what
# vite.config.ts binds with strictPort, so it belongs to the main checkout and a
# worktree taking it would fight the developer's own dev server. Two runs on the
# host never share a port because the lock lives in the main checkout (cez-lib.sh:
# LOCK_ROOT) and a port that something else already listens on is skipped even
# without a lock.
#
#   scripts/agent/cez-port.sh acquire   # prints the port, pins it in .agent/port
#   scripts/agent/cez-port.sh release   # frees the pinned port
#   scripts/agent/cez-port.sh current   # prints the pinned port or exits 1
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

POOL_FROM=3011
POOL_TO=3020
PIN="$AGENT_DIR/port"

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN > /dev/null 2>&1; }

case "${1:-}" in
  acquire)
    if [ -s "$PIN" ]; then cat "$PIN"; exit 0; fi
    mkdir -p "$AGENT_DIR"
    for ((p = POOL_FROM; p <= POOL_TO; p++)); do
      listening "$p" && continue
      if lock_acquire "port-$p"; then
        # The lock's pid is this short-lived script; leave the worktree path so a sweeper
        # or a human can tell whose port it is, and so release can check ownership.
        git rev-parse --show-toplevel > "$LOCK_ROOT/port-$p.lock/worktree"
        printf '%s\n' "$p" > "$PIN"
        printf '%s\n' "$p"
        exit 0
      fi
    done
    die "no free port in $POOL_FROM-$POOL_TO"
    ;;
  release)
    [ -s "$PIN" ] || exit 0
    p=$(cat "$PIN")
    lock="$LOCK_ROOT/port-$p.lock"
    if [ "$(cat "$lock/worktree" 2>/dev/null || true)" = "$(git rev-parse --show-toplevel)" ]; then
      rm -rf "$lock"
    fi
    rm -f "$PIN"
    ;;
  current)
    [ -s "$PIN" ] && cat "$PIN"
    ;;
  *)
    die "usage: cez-port.sh acquire|release|current"
    ;;
esac
