#!/usr/bin/env bash
# Register docs/agents/cezar-automations.json with the running cezar through its API (never by
# editing .ai/cezar/automations.json by hand). Idempotent: an automation with the same name is
# updated in place and re-enabled, a new one is created enabled. Automations the cockpit holds
# that the file no longer names are listed; --prune deletes them, so the file is the whole truth.
#
#   .ai/scripts/cez-automations.sh [--dry-run] [--prune]
#
# --prune refuses to delete an enabled stray: an automation somebody turned on by hand is not
# retired, and losing it silently is the one mistake this script could make that the file cannot
# undo. Disable it in the cockpit first, then prune.
#
# Needs the service started with CEZ_AUTOMATIONS=1; a 409 from the API says it was not.
set -euo pipefail

API="${CEZ_API:-http://localhost:4321}/api/v1/p/${CEZ_PROJECT:-money-tracker-online}/automations"
# The checkout this script lives in, not the main one: the worktree that carries the definitions.
FILE="$(cd "$(dirname "$0")/../.." && pwd)/docs/agents/cezar-automations.json"
DRY=0
PRUNE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --prune) PRUNE=1 ;;
    *) printf 'usage: %s [--dry-run] [--prune]\n' "$0" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

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

# Definitions the cockpit still holds that the file no longer names.
known=$(jq -r '.[].name' "$FILE")
# Tab-delimited, with the name LAST: a display name has spaces ("Spec to tickets"), and a
# space-separated `read -r name enabled id` shreds it across all three variables - which made
# every automation look like a stray AND corrupted the `enabled` guard below, so --prune would
# have offered to delete live automations.
jq -r '.automations[]? | [.id, .enabled, .name] | @tsv' <<<"$LIST" | while IFS=$'\t' read -r id enabled name; do
  grep -qx "$name" <<<"$known" && continue
  if [ "$PRUNE" -eq 0 ]; then
    say "not in file: $name ($id, enabled: $enabled) - rerun with --prune to delete it"
  elif [ "$enabled" != "false" ]; then
    say "kept $name ($id): still enabled - disable it in the cockpit, then prune"
  elif [ "$DRY" -eq 1 ]; then
    say "would delete $name ($id)"
  else
    out=$(curl -sS -X DELETE "$API/$id" -w '\n%{http_code}')
    [ "$(tail -1 <<<"$out")" = "204" ] || die "DELETE $name -> $(tail -1 <<<"$out"): $(sed '$d' <<<"$out")"
    say "deleted $name ($id)"
  fi
done
