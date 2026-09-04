#!/usr/bin/env bash
# The verification ladder an implement run climbs before it hands back. Wraps validate.sh
# with the cezar rules: a budget of 3 passes, the floor guard first, `pnpm build` on,
# chromium only, a narrowed rerun of last pass's red specs from pass 2 that can only say
# "still red" (a narrowed green never decides), a heartbeat, and a digest capped at 20 kB
# for the agent to read instead of raw logs.
#
#   scripts/agent/cez-ladder.sh [--skip-e2e] [--no-build]
#
# Exit 0 green, 1 red, 3 budget exhausted. Digest: .agent/ladder-digest.md, verdict JSON:
# .agent/ladder.json.
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"
HERE=$(cd "$(dirname "$0")" && pwd)

SKIP_E2E=0
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --skip-e2e) SKIP_E2E=1 ;;
    --no-build) BUILD=0 ;;
    *) die "unknown flag: $arg" ;;
  esac
done

mkdir -p "$AGENT_DIR"
PASS_FILE="$AGENT_DIR/ladder-pass"
PASS=$(( $(cat "$PASS_FILE" 2>/dev/null || echo 0) + 1 ))
if [ "$PASS" -gt 3 ]; then
  say "ladder budget exhausted (3 passes): hand back with --blocked instead of trying again"
  exit 3
fi
printf '%s\n' "$PASS" > "$PASS_FILE"
heartbeat

BASE="${CEZ_BASE_BRANCH:-develop}"
if git rev-parse --verify --quiet "origin/$BASE^{commit}" > /dev/null; then TARGET="origin/$BASE"; else TARGET="$BASE"; fi
PORT=$(bash "$HERE/cez-port.sh" current || echo 3011)
DIGEST="$AGENT_DIR/ladder-digest.md"
VERDICT="$AGENT_DIR/ladder.json"
PREVIOUS="$AGENT_DIR/ladder-previous.json"
[ -s "$VERDICT" ] && cp "$VERDICT" "$PREVIOUS"
LOG_DIR="${TMPDIR:-/tmp}"

# Digest: steps, failed specs, tails of red logs. Capped so a run never reads megabytes.
write_digest() { # verdict-json label
  local v="$1" label="$2" out
  out=$(
    echo "# Ladder pass $PASS ($label)"
    echo
    jq -r '"ok: \(.ok)  uiTouched: \(.uiTouched)  infra: \(.infra // "none")"' "$v"
    echo
    echo "| step | ok | s |"
    echo "|---|---|---|"
    jq -r '.steps[] | "| \(.name) | \(if .ok then "✓" else "✗" end) | \(.durationMs / 1000 | floor) |"' "$v"
    echo
    if [ "$(jq '.e2e.failed | length' "$v")" -gt 0 ]; then
      echo "## Failed specs"
      jq -r '.e2e.failed[] | "- \(.title)\n  \(.error // "" | gsub("\n"; " ") | .[0:300])"' "$v"
      echo
    fi
    for name in $(jq -r '.steps[] | select(.ok | not) | .name' "$v"); do
      log="$LOG_DIR/validate-${name//[^a-zA-Z0-9]/-}.log"
      [ -s "$log" ] || continue
      echo "## $name (log tail)"
      echo '```'
      tail -n 80 "$log"
      echo '```'
      echo
    done
  )
  printf '%s\n' "$out" | head -c 20000 > "$DIGEST"
}

floor_guard_digest() {
  {
    echo "# Ladder pass $PASS (floor guard)"
    echo
    echo "The diff lowers the quality floor; remove these before running the ladder again:"
    echo
    jq -r '.findings[] | "- \(.file)\(if .line then ":" + (.line|tostring) else "" end) \(.rule): \(.text)"' "$AGENT_DIR/floor-guard.json"
  } > "$DIGEST"
}

say "==> floor guard against $TARGET"
if ! node "$HERE/floor-guard.mjs" --base "$TARGET" > "$AGENT_DIR/floor-guard.json"; then
  floor_guard_digest
  jq -n '{ok: false, steps: [{name: "floor-guard", ok: false, durationMs: 0}], uiTouched: false, e2e: {failed: []}, infra: null}' > "$VERDICT"
  say "floor guard red; see $DIGEST"
  exit 1
fi

ARGS=(--e2e-projects chromium)
[ "$BUILD" -eq 1 ] && ARGS+=(--build)
[ "$SKIP_E2E" -eq 1 ] && ARGS+=(--skip-e2e)

run_validate() { # json-out extra-args...
  local out="$1"; shift
  clean_env TARGET_BRANCH="$TARGET" E2E_PORT="$PORT" -- \
    bash "$HERE/validate.sh" --json-out "$out" "${ARGS[@]}" "$@"
}

# From pass 2: rerun last pass's red specs first. Red there is the verdict; green only
# earns the full run.
if [ "$PASS" -ge 2 ] && [ -s "$PREVIOUS" ] && [ "$SKIP_E2E" -eq 0 ]; then
  GREP=$(jq -r '[.e2e.failed[0:10][] .title | gsub("[.*+?^${}()|\\[\\]\\\\]"; "\\\\" + .)] | join("|")' "$PREVIOUS")
  if [ -n "$GREP" ]; then
    say "==> narrowed rerun of last pass's failures"
    if ! run_validate "$AGENT_DIR/ladder-narrowed.json" --e2e-grep "$GREP"; then
      cp "$AGENT_DIR/ladder-narrowed.json" "$VERDICT"
      write_digest "$VERDICT" "narrowed: still red"
      heartbeat
      exit 1
    fi
  fi
fi

say "==> full ladder"
if run_validate "$VERDICT"; then RC=0; else RC=1; fi
write_digest "$VERDICT" "full"
worktree_tree_id > "$AGENT_DIR/ladder-tree"
heartbeat
say "==> pass $PASS $([ "$RC" -eq 0 ] && echo green || echo red); digest at $DIGEST"
exit "$RC"
