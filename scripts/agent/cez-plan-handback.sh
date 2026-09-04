#!/usr/bin/env bash
# The plan skill's exit when it cannot finish: the autonomy nudge arrived, the human went
# away, a hard stop (open questions the human would not resolve). Marks the issue
# needs-human with the reason so the sweeper never has to guess.
#
#   scripts/agent/cez-plan-handback.sh --blocked --reason "<why>"
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

BLOCKED=0
REASON=""
while [ $# -gt 0 ]; do
  case "$1" in
    --blocked) BLOCKED=1; shift ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    *) die "unknown flag: $1" ;;
  esac
done
[ "$BLOCKED" -eq 1 ] || die "usage: cez-plan-handback.sh --blocked --reason <text>"
[ -n "$REASON" ] || die "--reason is required"

N=$(issue_number) || die "no issue pinned for this run"
ARTEFACTS=$(ls "$AGENT_DIR/plan" 2>/dev/null | sed 's/^/- .agent\/plan\//' || true)
{
  printf 'Plan run `%s` stopped without publishing.\n\n**Reason:** %s\n' "$RUN8" "$REASON"
  [ -n "$ARTEFACTS" ] && printf '\nDrafts left in the worktree `cez/%s`:\n%s\n' "$RUN8" "$ARTEFACTS"
  printf '\nHand the issue to the agent again from the cockpit to continue.\n'
} | comment_upsert "$N" "<!-- agent-result: needs-human -->"
swap_status "$N" "status: needs-human"
say "==> #$N handed back as needs-human"
