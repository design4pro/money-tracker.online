#!/usr/bin/env bash
# Register the prompt templates in docs/agents/cezar-prompt-templates.json with the running
# cezar through its API (never by editing .ai/cezar/ui-state.json by hand: the cockpit adopts
# the PUT response as authoritative and would overwrite a hand-edited file on the next save).
#
#   scripts/agent/cez-prompt-templates.sh [--dry-run]
#
# The file is the whole list: `promptTemplates` is replaced wholesale, so a template deleted
# here disappears from the cockpit on the next run. Every other ui-state key survives — the
# API merges the top level shallowly, and this sends that one key.
#
# Prompt templates are what the "templates" dropdown of GitHub -> issue -> "Hand this to the
# agent" inserts into the prompt box. The box is pre-filled with the issue's reference block
# and a template is inserted at the caret, so the text below extends the reference rather than
# replacing it. That is how a `plan` run is told which mode to run: the skill reads the mode
# word out of its arguments (docs/agents/cezar.md -> Prompt templates).
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

API="${CEZ_API:-http://localhost:4321}/api/v1/p/${CEZ_PROJECT:-money-tracker}/ui-state"
# The checkout this script lives in, not the main one: the worktree that carries the definitions.
FILE="$(cd "$(dirname "$0")/../.." && pwd)/docs/agents/cezar-prompt-templates.json"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# The cockpit's own bounds (uiStateSchema.promptTemplates), checked here so a bad edit fails
# with a sentence instead of a 400 from a route the operator cannot see.
jq -e '
  (type == "array") and (length >= 1) and (length <= 50)
  and (all(.[]; (.id | type == "string" and (length | . >= 1 and . <= 64))
                and (.label | type == "string" and (length | . >= 1 and . <= 80))
                and (.text | type == "string" and (length | . >= 1 and . <= 2000))
                and ((has("skills") | not) or (.skills | type == "array" and length <= 50))))
  and (([.[].id] | length) == ([.[].id] | unique | length))
' "$FILE" >/dev/null || die "$FILE does not satisfy the cockpit's bounds (see the jq filter above)"

BODY=$(jq -c '{promptTemplates: .}' "$FILE")

CURRENT=$(curl -sS "$API" -w '\n%{http_code}') || die "cezar unreachable at $API"
CODE=$(tail -1 <<<"$CURRENT")
STATE=$(sed '$d' <<<"$CURRENT")
[ "$CODE" = "200" ] || die "GET $API -> $CODE: $STATE"

HAVE=$(jq -c '[.promptTemplates[]?.id]' <<<"$STATE")
WANT=$(jq -c '[.[].id]' "$FILE")
say "cockpit has $HAVE"
say "file wants $WANT"
[ "$HAVE" = "$WANT" ] && say "note: the ids already match; the texts are replaced regardless"

if [ "$DRY" -eq 1 ]; then say "would PUT $(jq -r 'length' "$FILE") templates to $API"; exit 0; fi

OUT=$(curl -sS -X PUT "$API" -H 'content-type: application/json' -d "$BODY" -w '\n%{http_code}')
[ "$(tail -1 <<<"$OUT")" = "200" ] || die "PUT $API -> $(tail -1 <<<"$OUT"): $(sed '$d' <<<"$OUT")"
say "registered $(sed '$d' <<<"$OUT" | jq -r '.promptTemplates | length') templates"
