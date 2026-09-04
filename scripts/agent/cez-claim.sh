#!/usr/bin/env bash
# The `claim` command step of the `implement-ticket` workflow. Zero tokens: one preflight
# `gh issue view`, and every refusal drops `run: implement`, leaves a `refused` comment and
# exits 1 so the cockpit shows why and the sweeper has nothing to escalate. A claim swaps
# `status: * -> in-progress` and drops `run: implement` in one edit, writes the claim comment
# the heartbeat lives in, and adopts a pushed `claude/issue-<n>-*` branch when it merges
# cleanly onto origin/develop and touches no protected path.
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

N=$(issue_number) || die "no issue number in this run's task (expected '<n> <url>')"
BASE="${CEZ_BASE_BRANCH:-develop}"
RUN_LABEL="run: implement"

lock_acquire "issue-$N" 3 || die "another run holds issue-$N right now; leaving it to that run"
trap 'lock_release "issue-$N"' EXIT

say "==> refresh onto origin/$BASE"
git fetch --quiet origin "$BASE"
git reset --quiet --hard "origin/$BASE"

say "==> preflight #$N"
ISSUE=$(gh_issue_json "$N" state,labels,subIssuesSummary,blockedBy)
LABELS=$(jq -r '[.labels[].name] | join("\n")' <<<"$ISSUE")
has_label() { grep -qxF "$1" <<<"$LABELS"; }
STATUS=$(grep '^status: ' <<<"$LABELS" | head -1 || true)

refuse() { # reason
  warn "refused: $1"
  if has_label "$RUN_LABEL"; then
    gh issue edit "$N" --repo "$REPO" --remove-label "$RUN_LABEL" > /dev/null
  fi
  printf 'Implement run `%s` refused this ticket.\n\n**Reason:** %s\n\nFix the cause and add `run: implement` again.\n' "$RUN8" "$1" \
    | comment_upsert "$N" "<!-- agent-result: refused -->"
  exit 1
}

[ "$(jq -r .state <<<"$ISSUE")" = "OPEN" ] || refuse "#$N is not open"
has_label "$RUN_LABEL" || refuse "#$N carries no \`$RUN_LABEL\` (removed before the run started?)"
has_label prd && refuse "#$N is a PRD; implement runs take its tickets"
[ "$(jq -r '.subIssuesSummary.total // 0' <<<"$ISSUE")" = "0" ] || refuse "#$N has sub-issues; implement runs take leaves only"
case "$STATUS" in
  "status: ready"|"status: needs-human") ;;
  *) refuse "#$N is at \`${STATUS:-no status}\`; only \`status: ready\` or \`status: needs-human\` can start" ;;
esac
OPEN_BLOCKERS=$(jq -r '[.blockedBy.nodes[]? | select(.state == "OPEN") | "#\(.number)"] | join(", ")' <<<"$ISSUE")
[ -z "$OPEN_BLOCKERS" ] || refuse "#$N is blocked by open $OPEN_BLOCKERS"
# The prefix is inlined: `gh pr list --jq` takes one argument and has no `--arg` (run 1276caf4).
OPEN_PR=$(gh pr list --repo "$REPO" --state open --json number,headRefName \
  --jq "[.[] | select(.headRefName | startswith(\"claude/issue-$N-\")) | \"#\\(.number)\"] | join(\", \")")
[ -z "$OPEN_PR" ] || refuse "#$N already has an open agent PR ($OPEN_PR); review or close it first"

mkdir -p "$AGENT_DIR"
printf '%s\n' "$N" > "$AGENT_DIR/issue"

rollback() {
  warn "claim failed after the label swap; restoring ${STATUS:-no status} and $RUN_LABEL"
  gh issue edit "$N" --repo "$REPO" --add-label "$RUN_LABEL" ${STATUS:+--add-label "$STATUS"} --remove-label "status: in-progress" > /dev/null || true
}
trap 'rollback; lock_release "issue-$N"' ERR

say "==> claim"
gh issue edit "$N" --repo "$REPO" --add-label "status: in-progress" --remove-label "$RUN_LABEL" \
  ${STATUS:+--remove-label "$STATUS"} > /dev/null
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf 'Implement run `%s` holds this ticket (branch `claude/issue-%s-%s`).\n<!-- agent-heartbeat: %s -->\n' \
  "$RUN8" "$N" "$RUN8" "$STAMP" | comment_upsert "$N" "<!-- agent-claim: $RUN_ID -->"

# Adoption: a branch an earlier run pushed for this ticket, when it is cut from a snapshot
# that still merges cleanly and never touched the agent's own configuration.
ADOPTED=""
git fetch --quiet origin "refs/heads/claude/issue-$N-*:refs/remotes/origin/claude/issue-$N-*" 2>/dev/null || true
for ref in $(git for-each-ref --sort=-committerdate --format='%(refname:short)' "refs/remotes/origin/claude/issue-$N-*"); do
  [ -z "$ADOPTED" ] || { warn "also found $ref; adopting only the newest"; continue; }
  if [ -z "$(git rev-list "origin/$BASE..$ref")" ]; then warn "$ref carries nothing new; skipped"; continue; fi
  if git diff --name-only "$(git merge-base "origin/$BASE" "$ref")" "$ref" | grep -Eq "$PROTECTED_PATH_RE"; then
    warn "$ref touches a protected path; not adopted"; continue
  fi
  if ! git merge-tree --write-tree "origin/$BASE" "$ref" > /dev/null 2>&1; then
    warn "$ref does not merge cleanly onto origin/$BASE; not adopted"; continue
  fi
  git merge --quiet --no-edit "$ref"
  ADOPTED="$ref"
  say "==> adopted $ref ($(git rev-list --count "origin/$BASE..$ref") commits)"
done

trap 'lock_release "issue-$N"' ERR
jq -n --arg n "$N" --arg run "$RUN_ID" --arg prev "$STATUS" --arg at "$STAMP" --arg adopted "$ADOPTED" \
  '{issue: ($n|tonumber), run: $run, previousStatus: $prev, claimedAt: $at, adopted: (if $adopted == "" then null else $adopted end)}' \
  > "$AGENT_DIR/claim.json"
say "==> #$N claimed by run $RUN8"
