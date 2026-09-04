#!/usr/bin/env bash
# Publish .agent/plan/prd.md into the issue this run holds: needs a spec/v1 (or prd/v1 when
# revising) body already there, validates prd/v1, retitles `PRD: ...`, labels `prd`, keeps
# the <details> block, and hands the issue to the human at `status: review`.
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"
HERE=$(cd "$(dirname "$0")" && pwd)

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1
N=$(issue_number) || die "no issue pinned for this run (.agent/issue)"
FILE="$AGENT_DIR/plan/prd.md"
[ -s "$FILE" ] || die "$FILE is missing"
node "$HERE/plan.mjs" check-body prd/v1 "$FILE" || die "$FILE is not a valid prd/v1"
if [ "$CHECK" -eq 1 ]; then say "==> $FILE is a valid prd/v1"; exit 0; fi

[ "$(gh_issue_json "$N" state --jq .state)" = "OPEN" ] || die "#$N is not open"
CURRENT=$(gh_issue_json "$N" body --jq .body)
case "$CURRENT" in
  "<!-- schema: spec/v1 -->"*|"<!-- schema: prd/v1 -->"*) ;;
  *) die "#$N carries no spec/v1 body; publish the spec first" ;;
esac
TMP=$(mktemp "${TMPDIR:-/tmp}/prd.XXXXXX")
trap 'rm -f "$TMP"' EXIT
plan_body_with_original "$FILE" "$CURRENT" | neutralise > "$TMP"
node "$HERE/plan.mjs" check-body prd/v1 "$TMP" || die "assembled body is not a valid prd/v1"

TITLE=$(gh_issue_json "$N" title --jq .title | neutralise)
TITLE="PRD: ${TITLE#PRD: }"
say "==> #$N body <- prd/v1, title '$TITLE', label prd"
gh issue edit "$N" --repo "$REPO" --title "$TITLE" --body-file "$TMP" --add-label prd > /dev/null
if [ -s "$AGENT_DIR/plan/grilling.md" ]; then
  comment_upsert "$N" "<!-- agent-grilling -->" < "$AGENT_DIR/plan/grilling.md"
fi
swap_status "$N" "status: review"
say "==> #$N at status: review; a human reads the PRD and starts the tickets mode"
