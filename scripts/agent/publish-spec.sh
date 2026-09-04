#!/usr/bin/env bash
# Publish .agent/plan/spec.md into the issue this run holds: validates spec/v1, keeps the
# human's original request in <details>, posts the grilling log as one comment, and hands
# the issue to the human at `status: review`. `--check` validates the draft and stops.
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"
HERE=$(cd "$(dirname "$0")" && pwd)

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1
N=$(issue_number) || die "no issue pinned for this run (.agent/issue)"
FILE="$AGENT_DIR/plan/spec.md"
[ -s "$FILE" ] || die "$FILE is missing"
node "$HERE/plan.mjs" check-body spec/v1 "$FILE" || die "$FILE is not a valid spec/v1"
if [ "$CHECK" -eq 1 ]; then say "==> $FILE is a valid spec/v1"; exit 0; fi

[ "$(gh_issue_json "$N" state --jq .state)" = "OPEN" ] || die "#$N is not open"
CURRENT=$(gh_issue_json "$N" body --jq .body)
TMP=$(mktemp "${TMPDIR:-/tmp}/spec.XXXXXX")
trap 'rm -f "$TMP"' EXIT
plan_body_with_original "$FILE" "$CURRENT" | neutralise > "$TMP"
node "$HERE/plan.mjs" check-body spec/v1 "$TMP" || die "assembled body is not a valid spec/v1"

say "==> #$N body <- spec/v1"
gh issue edit "$N" --repo "$REPO" --body-file "$TMP" > /dev/null
if [ -s "$AGENT_DIR/plan/grilling.md" ]; then
  say "==> grilling log"
  comment_upsert "$N" "<!-- agent-grilling -->" < "$AGENT_DIR/plan/grilling.md"
fi
swap_status "$N" "status: review"
say "==> #$N at status: review; a human reads the spec and starts the prd mode"
