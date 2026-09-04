#!/usr/bin/env bash
# Publish .agent/plan/tickets.json as sub-issues of the PRD this run holds. plan.mjs does the
# work (checks, topological create, sub_issues, blocked_by, first wave, PRD in-progress, all
# resumable through the <!-- agent-tickets --> comment); this wrapper pins the issue and the
# preconditions. `--check` validates the plan and stops; `--dry-run` prints the creates.
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"
HERE=$(cd "$(dirname "$0")" && pwd)

MODE=publish
case "${1:-}" in
  --check) MODE=check ;;
  --dry-run) MODE=dry ;;
  "") ;;
  *) die "usage: publish-tickets.sh [--check|--dry-run]" ;;
esac
N=$(issue_number) || die "no issue pinned for this run (.agent/issue)"
FILE="$AGENT_DIR/plan/tickets.json"
[ -s "$FILE" ] || die "$FILE is missing"
node "$HERE/plan.mjs" check-tickets "$FILE" --prd "$N" || die "$FILE is not a valid ticket plan"
if [ "$MODE" = check ]; then say "==> $FILE is a valid ticket plan for #$N"; exit 0; fi

[ "$(gh_issue_json "$N" state --jq .state)" = "OPEN" ] || die "#$N is not open"
case "$(gh_issue_json "$N" body --jq .body)" in
  "<!-- schema: prd/v1 -->"*) ;;
  *) die "#$N carries no prd/v1 body; publish the PRD first" ;;
esac
if [ "$MODE" = dry ]; then exec node "$HERE/plan.mjs" publish "$FILE" --dry-run; fi
say "==> publishing tickets under PRD #$N"
node "$HERE/plan.mjs" publish "$FILE"
