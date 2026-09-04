#!/usr/bin/env bash
# The `claim` command step of the `triage` workflow. Two ways in: the `triage-opened` automation
# (a new issue carrying `status: triage`) and `run: triage` from a human. The marker
# `<!-- agent-triage -->` blocks only the first; a human's `run:` re-triages on purpose. Zero
# tokens. On the `run:` path a refusal drops the label, comments `refused` and exits 1; on the
# opened path a stand-down exits 1 and writes nothing, so a second poll of the same event is a
# no-op.
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

N=$(issue_number) || die "no issue number in this run's task (expected '<n> <url>')"
BASE="${CEZ_BASE_BRANCH:-develop}"
RUN_LABEL="run: triage"
MARKER="<!-- agent-triage -->"

lock_acquire "issue-$N" 3 || die "another run holds issue-$N right now; leaving it to that run"
trap 'lock_release "issue-$N"' EXIT

say "==> refresh onto origin/$BASE"
git fetch --quiet origin "$BASE"
git reset --quiet --hard "origin/$BASE"

say "==> preflight #$N"
ISSUE=$(gh_issue_json "$N" state,labels,subIssuesSummary)
LABELS=$(jq -r '[.labels[].name] | join("\n")' <<<"$ISSUE")
has_label() { grep -qxF "$1" <<<"$LABELS"; }
STATUS=$(grep '^status: ' <<<"$LABELS" | head -1 || true)
COMMANDED=0
has_label "$RUN_LABEL" && COMMANDED=1

refuse() { # reason
  warn "refused: $1"
  if [ "$COMMANDED" -eq 1 ]; then
    gh issue edit "$N" --repo "$REPO" --remove-label "$RUN_LABEL" > /dev/null
    printf 'Triage run `%s` refused this issue.\n\n**Reason:** %s\n\nFix the cause and add `run: triage` again.\n' "$RUN8" "$1" \
      | comment_upsert "$N" "<!-- agent-result: refused -->"
  fi
  exit 1
}

[ "$(jq -r .state <<<"$ISSUE")" = "OPEN" ] || refuse "#$N is not open"
[ "$(jq -r '.subIssuesSummary.total // 0' <<<"$ISSUE")" = "0" ] || refuse "#$N has sub-issues; a PRD is never triaged"
case "$STATUS" in
  "status: in-progress") refuse "#$N is in progress under another run; wait for it to hand back" ;;
  "status: review") refuse "#$N waits for a human at \`status: review\`" ;;
esac
if [ "$COMMANDED" -eq 0 ]; then
  [ "$STATUS" = "status: triage" ] || refuse "#$N is at \`${STATUS:-no status}\`; without \`$RUN_LABEL\` only \`status: triage\` is triaged"
  [ -z "$(comment_id_by_marker "$N" "$MARKER")" ] || refuse "#$N was triaged already; add \`$RUN_LABEL\` to repeat"
fi

mkdir -p "$AGENT_DIR/triage"
printf '%s\n' "$N" > "$AGENT_DIR/issue"

rollback() {
  warn "claim failed after the label swap; restoring ${STATUS:-no status}"
  gh issue edit "$N" --repo "$REPO" ${STATUS:+--add-label "$STATUS"} --remove-label "status: in-progress" > /dev/null || true
}
trap 'rollback; lock_release "issue-$N"' ERR

say "==> claim"
REMOVE=()
[ "$COMMANDED" -eq 1 ] && REMOVE+=(--remove-label "$RUN_LABEL")
[ -n "$STATUS" ] && REMOVE+=(--remove-label "$STATUS")
gh issue edit "$N" --repo "$REPO" --add-label "status: in-progress" ${REMOVE[@]+"${REMOVE[@]}"} > /dev/null
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf 'Triage run `%s` holds this issue.\n<!-- agent-heartbeat: %s -->\n' "$RUN8" "$STAMP" \
  | comment_upsert "$N" "<!-- agent-claim: $RUN_ID -->"
trap 'lock_release "issue-$N"' ERR
jq -n --arg n "$N" --arg run "$RUN_ID" --arg prev "$STATUS" --arg at "$STAMP" --argjson cmd "$COMMANDED" \
  '{issue: ($n|tonumber), run: $run, previousStatus: $prev, claimedAt: $at, commanded: ($cmd == 1)}' \
  > "$AGENT_DIR/claim.json"
say "==> #$N claimed by triage run $RUN8"
