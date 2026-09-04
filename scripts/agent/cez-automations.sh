#!/usr/bin/env bash
# Register the automations in docs/agents/cezar-automations.json with the running cezar
# through its API (never by editing .ai/cezar/automations.json by hand). Idempotent: an
# automation with the same name is updated in place, a new one is created enabled.
#
#   scripts/agent/cez-automations.sh [--dry-run]
#
# Needs the service started with CEZ_AUTOMATIONS=1; a 409 from the API says it was not.
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

API="${CEZ_API:-http://localhost:4321}/api/v1/p/${CEZ_PROJECT:-money-tracker}/automations"
# The checkout this script lives in, not the main one: the worktree that carries the definitions.
FILE="$(cd "$(dirname "$0")/../.." && pwd)/docs/agents/cezar-automations.json"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

EXISTING=$(curl -sS "$API" -w '\n%{http_code}') || die "cezar unreachable at $API"
CODE=$(tail -1 <<<"$EXISTING")
LIST=$(sed '$d' <<<"$EXISTING")
case "$CODE" in
  200) ;;
  409) die "cezar answered 409: $(jq -r .error <<<"$LIST" 2>/dev/null || echo "$LIST")" ;;
  *) die "GET $API -> $CODE: $LIST" ;;
esac

jq -c '.[]' "$FILE" | while read -r def; do
  name=$(jq -r .name <<<"$def")
  current=$(jq -c --arg n "$name" '.automations[]? | select(.name == $n)' <<<"$LIST" | head -1)
  if [ -n "$current" ]; then
    id=$(jq -r .id <<<"$current"); rev=$(jq -r .revision <<<"$current")
    body=$(jq -c --argjson rev "$rev" '. + {enabled: true, expectedRevision: $rev}' <<<"$def")
    if [ "$DRY" -eq 1 ]; then say "would update $name ($id, revision $rev)"; continue; fi
    out=$(curl -sS -X PUT "$API/$id" -H 'content-type: application/json' -d "$body" -w '\n%{http_code}')
    [ "$(tail -1 <<<"$out")" = "200" ] || die "PUT $name -> $(tail -1 <<<"$out"): $(sed '$d' <<<"$out")"
    say "updated $name ($id)"
  else
    body=$(jq -c '. + {enable: true}' <<<"$def")
    if [ "$DRY" -eq 1 ]; then say "would create $name"; continue; fi
    out=$(curl -sS -X POST "$API" -H 'content-type: application/json' -d "$body" -w '\n%{http_code}')
    [ "$(tail -1 <<<"$out")" = "201" ] || die "POST $name -> $(tail -1 <<<"$out"): $(sed '$d' <<<"$out")"
    say "created $name ($(sed '$d' <<<"$out" | jq -r .automation.id))"
  fi
done
