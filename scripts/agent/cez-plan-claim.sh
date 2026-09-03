#!/usr/bin/env bash
# The `claim` command step of the `plan` workflow. Reads the issue from cezar's run record
# (cez-lib.sh: run_task), refreshes the worktree onto origin/develop, and takes the issue:
# `status: * -> in-progress` plus the claim comment the sweeper reads. A refusal exits 1
# before any write, so the cockpit shows it and nothing on GitHub changes.
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

N=$(issue_number) || die "no issue number in this run's task (expected '<n> <url> spec|prd|tickets')"
BASE="${CEZ_BASE_BRANCH:-develop}"

say "==> refresh onto origin/$BASE"
git fetch --quiet origin "$BASE"
git reset --quiet --hard "origin/$BASE"

say "==> preflight #$N"
STATE=$(gh_issue_json "$N" state,labels)
[ "$(jq -r .state <<<"$STATE")" = "OPEN" ] || die "#$N is not open"
PREV=$(jq -r '[.labels[].name | select(startswith("status: "))] | .[0] // empty' <<<"$STATE")
if [ "$PREV" = "status: in-progress" ]; then
  HOLDER=$(gh api --paginate "repos/$REPO/issues/$N/comments" --jq '.[] | .body | capture("<!-- agent-claim: (?<r>[^ ]+) -->") | .r' | tail -1 || true)
  if [ -n "$HOLDER" ] && [ "$HOLDER" != "$RUN_ID" ]; then
    die "#$N is in progress under run ${HOLDER:0:8}; hand that run back first"
  fi
fi

mkdir -p "$AGENT_DIR/plan"
printf '%s\n' "$N" > "$AGENT_DIR/issue"

rollback() {
  warn "claim failed after the status swap; restoring ${PREV:-no status}"
  [ -n "$PREV" ] && swap_status "$N" "$PREV" || true
}
trap rollback ERR

say "==> claim"
swap_status "$N" "status: in-progress"
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf 'Plan run `%s` holds this issue (worktree branch `cez/%s`).\n<!-- agent-heartbeat: %s -->\n' "$RUN8" "$RUN8" "$STAMP" \
  | comment_upsert "$N" "<!-- agent-claim: $RUN_ID -->"
trap - ERR
jq -n --arg n "$N" --arg run "$RUN_ID" --arg prev "$PREV" --arg at "$STAMP" \
  '{issue: ($n|tonumber), run: $run, previousStatus: $prev, claimedAt: $at}' > "$AGENT_DIR/claim.json"
say "==> #$N claimed by run $RUN8"
