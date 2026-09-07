#!/usr/bin/env bash
# Install docs/agents/cezar-prompt-templates.json into the running cezar through its API (never by
# editing .ai/cezar/ui-state.json by hand). One template per om-* skill: the task text, the flags
# and the preconditions, so the cockpit composer carries what SKILL.md knows.
#
#   scripts/cezar/prompt-templates.sh [--dry-run]
#
# The PUT merges shallowly at the top level, so only `promptTemplates` is replaced and every other
# preference in ui-state.json survives. Idempotent: the array is written wholesale.
#
# Cezar's normalizer drops or truncates silently, so the caps are checked here instead: at most 50
# templates, label <= 80 chars, text <= 2000, ids unique and non-empty. A template whose `skills`
# array names the selected skill is applied automatically while the composer is pristine; skills
# taking an issue or PR number carry no `skills` on purpose (docs/agents/cezar.md).
#
# The skill collection is not vendored here: `.claude/skills/om-*` are symlinks that
# `pnpm install-skills` writes into the gitignored `.agents/skills/`. Run it first, or the
# installed-skill check below has nothing to compare against.
set -euo pipefail

API="${CEZ_API:-http://localhost:4321}/api/v1/p/${CEZ_PROJECT:-money-tracker-online}/ui-state"
# The checkout this script lives in, not the main one: the worktree that carries the templates.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FILE="$ROOT/docs/agents/cezar-prompt-templates.json"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

say() { printf '%s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$FILE" ] || die "missing $FILE"
jq -e 'type == "array"' "$FILE" >/dev/null || die "$FILE is not a JSON array"

jq -e '
  length <= 50
  and (map(.id) | unique | length) == length
  and all(.[]; (.id | type == "string" and length > 0)
            and (.label | type == "string" and length > 0 and length <= 80)
            and (.text | type == "string" and length > 0 and length <= 2000)
            and ((.skills // []) | type == "array" and length <= 50))
' "$FILE" >/dev/null || die "$FILE violates cezar's caps (<=50 templates, label <=80, text <=2000, unique ids)"

# Every id, and every skill a template binds to, must be an installed skill.
[ -d "$ROOT/.claude/skills" ] || die "no .claude/skills - run pnpm install-skills first"
installed=$(cd "$ROOT/.claude/skills" && printf '%s\n' om-*/ | sed 's:/$::' | sort)
[ "$installed" = "om-*" ] && die "no om-* skills linked - run pnpm install-skills first"
strays=$(comm -13 <(printf '%s\n' "$installed") \
                  <(jq -r '.[].id, (.[].skills // [])[]' "$FILE" | sort -u))
[ -z "$strays" ] || die "not installed skills: $(tr '\n' ' ' <<<"$strays")"

total=$(jq 'length' "$FILE")
bound=$(jq '[.[] | select(.skills)] | length' "$FILE")

CURRENT=$(curl -sS "$API" -w '\n%{http_code}') || die "cezar unreachable at $API"
CODE=$(tail -1 <<<"$CURRENT")
STATE=$(sed '$d' <<<"$CURRENT")
[ "$CODE" = "200" ] || die "GET $API -> $CODE: $STATE"
had=$(jq '.promptTemplates | length // 0' <<<"$STATE" 2>/dev/null || echo 0)

if [ "$DRY" -eq 1 ]; then
  say "would install $total templates ($bound bound to a skill); cockpit currently holds ${had:-0}"
  jq -r '.[] | "  \(.id)\t\(if .skills then "auto" else "manual" end)\t\(.label)"' "$FILE"
  exit 0
fi

BODY=$(jq -c '{promptTemplates: .}' "$FILE")
OUT=$(curl -sS -X PUT "$API" -H 'content-type: application/json' -d "$BODY" -w '\n%{http_code}')
[ "$(tail -1 <<<"$OUT")" = "200" ] || die "PUT $API -> $(tail -1 <<<"$OUT"): $(sed '$d' <<<"$OUT")"

now=$(sed '$d' <<<"$OUT" | jq '.promptTemplates | length')
[ "$now" = "$total" ] || die "cockpit stored $now of $total templates - check the caps above"
say "installed $total prompt templates ($bound bound to a skill, $((total - bound)) insert-only), was ${had:-0}"
