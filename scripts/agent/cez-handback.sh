#!/usr/bin/env bash
# The only exit of an implement run. Green: push `claude/issue-<n>-<run8>`, open a draft PR
# to develop labelled `agent-pr` (+ `needs-e2e` when the ladder saw UI), move the ticket to
# `status: review`. Blocked: commit and push the WIP, leave a digest, `status: needs-human`.
# A diff that touches the agent's own configuration or package.json's scripts never pushes.
# Never closes the issue (the sweeper does, after the merge). Always frees the port.
#
#   scripts/agent/cez-handback.sh                       # green: needs a ladder verdict for this tree
#   scripts/agent/cez-handback.sh --blocked --reason "<why>"
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"
HERE=$(cd "$(dirname "$0")" && pwd)

BLOCKED=0
REASON=""
while [ $# -gt 0 ]; do
  case "$1" in
    --blocked) BLOCKED=1; shift ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    *) die "unknown flag: $1" ;;
  esac
done
[ "$BLOCKED" -eq 0 ] || [ -n "$REASON" ] || die "--blocked needs --reason"

N=$(issue_number) || die "no issue pinned for this run (.agent/issue)"
BASE="${CEZ_BASE_BRANCH:-develop}"
BRANCH="claude/issue-$N-$RUN8"

teardown() {
  if [ -s "$AGENT_DIR/dev-server.pid" ]; then
    kill "$(cat "$AGENT_DIR/dev-server.pid")" 2>/dev/null || true
    rm -f "$AGENT_DIR/dev-server.pid"
  fi
  bash "$HERE/cez-port.sh" release || true
}
trap teardown EXIT

git fetch --quiet origin "$BASE"
MERGE_BASE=$(diff_base)
CHANGED=$( { git diff --name-only "$MERGE_BASE" HEAD; git status --porcelain | cut -c4-; } | sort -u)

# The lines an agent must never change, whatever the ticket says.
protected_hits() {
  grep -E "$PROTECTED_PATH_RE" <<<"$CHANGED" || true
  if grep -qx package.json <<<"$CHANGED" && git diff "$MERGE_BASE" -- package.json | grep -Eq '^[+-]\s*"(scripts|pnpm|packageManager)"'; then
    echo "package.json (scripts / pnpm / packageManager)"
  fi
}
HITS=$(protected_hits)
if [ -n "$HITS" ]; then
  BLOCKED=1
  REASON="protected paths changed: $(tr '\n' ' ' <<<"$HITS")${REASON:+ ($REASON)}"
  NO_PUSH=1
else
  NO_PUSH=0
fi

if [ "$BLOCKED" -eq 0 ]; then
  [ -z "$(git status --porcelain)" ] || die "uncommitted changes; commit them (by path) and run the handback again"
  [ -s "$AGENT_DIR/ladder.json" ] && [ "$(jq -r .ok "$AGENT_DIR/ladder.json")" = "true" ] \
    || die "no green ladder verdict; run scripts/agent/cez-ladder.sh (or hand back --blocked)"
  [ "$(cat "$AGENT_DIR/ladder-tree" 2>/dev/null)" = "$(worktree_tree_id)" ] \
    || die "the tree changed since the last ladder pass; run scripts/agent/cez-ladder.sh again"
  [ -n "$(git rev-list "$MERGE_BASE..HEAD")" ] || die "no commits on top of origin/$BASE; nothing to hand back"
fi

TITLE=$(gh_issue_json "$N" title,body --jq .title)
BODY_ISSUE=$(gh_issue_json "$N" body --jq .body)
UI=$(jq -r '.uiTouched // false' "$AGENT_DIR/ladder.json" 2>/dev/null || echo false)

if [ "$BLOCKED" -eq 1 ]; then
  say "==> blocked: $REASON"
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit --quiet -m "wip(agent): #$N handed back as needs-human" || true
  fi
  PUSHED=""
  if [ "$NO_PUSH" -eq 0 ] && [ -n "$(git rev-list "$MERGE_BASE..HEAD")" ]; then
    git push --quiet origin "HEAD:refs/heads/$BRANCH"
    PUSHED="$BRANCH"
  fi
  {
    printf 'Implement run `%s` stopped.\n\n**Reason:** %s\n\n' "$RUN8" "$REASON"
    if [ -n "$PUSHED" ]; then printf 'Work so far is on `%s`; a later run adopts it when it still merges cleanly.\n\n' "$PUSHED"
    else printf 'Nothing was pushed.\n\n'; fi
    if [ -s "$AGENT_DIR/ladder-digest.md" ]; then
      printf '<details><summary>Last ladder digest</summary>\n\n%s\n\n</details>\n' "$(head -c 6000 "$AGENT_DIR/ladder-digest.md")"
    fi
  } | comment_upsert "$N" "<!-- agent-result: needs-human -->"
  if [ -s "$AGENT_DIR/noticed.md" ]; then comment_upsert "$N" "<!-- agent-noticed -->" < "$AGENT_DIR/noticed.md"; fi
  swap_status "$N" "status: needs-human"
  say "==> #$N at status: needs-human"
  exit 0
fi

say "==> push $BRANCH"
git push --quiet origin "HEAD:refs/heads/$BRANCH"

PR=$(gh pr list --repo "$REPO" --head "$BRANCH" --state open --json number --jq '.[0].number // empty')
if [ -z "$PR" ]; then
  PR_BODY=$(mktemp "${TMPDIR:-/tmp}/pr-body.XXXXXX")
  {
    printf 'Refs #%s\n\n' "$N"
    if [ -s "$AGENT_DIR/summary.md" ]; then printf '## Summary\n\n%s\n\n' "$(cat "$AGENT_DIR/summary.md")"; fi
    if [ -s "$AGENT_DIR/dod.json" ]; then
      printf '## Definition of done (SPEC §7)\n\n'
      jq -r '.[] | "- [\(if .done then "x" else " " end)] \(.item)\(if .note then " — " + .note else "" end)"' "$AGENT_DIR/dod.json"
      printf '\n'
    fi
    if [ -s "$AGENT_DIR/ladder.json" ]; then
      printf '## Ladder\n\n| step | ok | s |\n|---|---|---|\n'
      jq -r '.steps[] | "| \(.name) | \(if .ok then "✓" else "✗" end) | \(.durationMs / 1000 | floor) |"' "$AGENT_DIR/ladder.json"
      printf '\nuiTouched: %s\n\n' "$UI"
    fi
    if [ -s "$AGENT_DIR/review.md" ]; then printf '## Self-review\n\n%s\n\n' "$(cat "$AGENT_DIR/review.md")"; fi
    if [ -s "$AGENT_DIR/noticed.md" ]; then printf '## Noticed but not touching\n\n%s\n\n' "$(cat "$AGENT_DIR/noticed.md")"; fi
    if grep -q '^## Visual change expected' <<<"$BODY_ISSUE"; then
      printf 'Baselines: the ticket declares a visual change; run update-snapshots.yml with commit-to-ref=%s before merging.\n\n' "$BRANCH"
    fi
    printf '<!-- agent-run: %s -->\n' "$RUN_ID"
  } | neutralise > "$PR_BODY"
  LABELS=(--label agent-pr)
  [ "$UI" = "true" ] && LABELS+=(--label needs-e2e)
  PR_URL=$(gh pr create --repo "$REPO" --draft --base "$BASE" --head "$BRANCH" "${LABELS[@]}" \
    --title "$(printf '%s (refs #%s)' "$TITLE" "$N" | neutralise)" --body-file "$PR_BODY")
  rm -f "$PR_BODY"
  PR="${PR_URL##*/}"
  say "==> PR #$PR"
else
  say "==> PR #$PR already open for $BRANCH; branch updated"
fi

printf 'Implement run `%s` handed back: draft PR #%s (`%s`).\n' "$RUN8" "$PR" "$BRANCH" \
  | comment_upsert "$N" "<!-- agent-result: ok -->"
if [ -s "$AGENT_DIR/noticed.md" ]; then comment_upsert "$N" "<!-- agent-noticed -->" < "$AGENT_DIR/noticed.md"; fi
swap_status "$N" "status: review"
printf 'CEZ:PR=%s\n' "$PR"
say "==> #$N at status: review"
