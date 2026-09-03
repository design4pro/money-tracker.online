#!/usr/bin/env bash
# The `setup` command step of every cezar workflow: turn a fresh `cez/<id8>` worktree into
# a place the agent step can typecheck, test and (unless --no-e2e) run Playwright in.
#
#   scripts/agent/cez-setup.sh [--no-e2e]
#
# Deterministic, idempotent, no LLM. Repo code runs under a scrubbed environment
# (cez-lib.sh: clean_env). The dev server it starts binds 127.0.0.1 on a port from the
# 3011-3020 pool and survives this step (nohup; pid in .agent/dev-server.pid).
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

NO_E2E=0
for arg in "$@"; do
  case "$arg" in
    --no-e2e) NO_E2E=1 ;;
    *) die "unknown flag: $arg" ;;
  esac
done

# Nothing runs after a failed command step, so this step closes its own state: release the
# port and hand the issue back (the claim put it at `status: in-progress`). An EXIT trap, not
# ERR: most of the work runs inside clean_env, and bash fires ERR inside a function only under
# errtrace - run 00e450a5 failed in setup-e2e.sh and left #98 in progress with the port held.
on_exit() {
  local rc=$? n
  [ "$rc" -eq 0 ] && return 0
  warn "setup failed (exit $rc); releasing the port and handing the issue back"
  bash "$(dirname "$0")/cez-port.sh" release || true
  n=$(issue_number 2>/dev/null || true)
  [ -n "$n" ] || return 0
  swap_status "$n" "status: needs-human" || true
  printf 'Setup failed in run `%s` before the agent started: the host or the dependencies, not the ticket. The run output in the cezar cockpit says which step.\n\nFix the cause and add the `run:` label again.\n' "$RUN8" \
    | comment_upsert "$n" "<!-- agent-result: needs-human -->" || true
}
trap on_exit EXIT

mkdir -p "$AGENT_DIR"

say "==> git identity and hooks"
# Husky's pre-commit runs the full ladder; the agent runs it on purpose through cez-ladder.sh.
git config core.hooksPath /dev/null
git config user.name money-tracker-agent
git config user.email money-tracker-agent@users.noreply.github.com

say "==> install"
clean_env -- pnpm install --frozen-lockfile --prefer-offline

say "==> route tree"
clean_env -- pnpm generate-routes

if [ "$NO_E2E" -eq 1 ]; then
  heartbeat
  printf '{"port":null,"e2e":false,"startedAt":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$AGENT_DIR/setup.json"
  say "==> setup done (no e2e)"
  exit 0
fi

say "==> port"
PORT=$(bash "$(dirname "$0")/cez-port.sh" acquire)
say "port $PORT"

say "==> e2e environment"
clean_env E2E_PORT="$PORT" -- bash "$(dirname "$0")/setup-e2e.sh" --if-needed

heartbeat
printf '{"port":%s,"e2e":true,"startedAt":"%s"}\n' "$PORT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$AGENT_DIR/setup.json"
say "==> setup done on :$PORT"
