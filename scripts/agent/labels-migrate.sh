#!/usr/bin/env bash
# Migrate the design4pro/money-tracker.online label set to the ADR 0014 protocol.
#
# Dry-run by default: every mutation is printed with a "(dry)" prefix and nothing is
# written to GitHub. `--apply` performs them. Idempotent: a second `--apply` is a no-op.
#
#   scripts/agent/labels-migrate.sh            # plan only
#   scripts/agent/labels-migrate.sh --apply    # perform
#
# Steps (docs/adr/0014-label-protocol.md, "Migration"):
#   0. snapshot labels and issues to docs/agents/migration/
#   1. rename the status labels that survive under a new name; create the rest; fix colours
#   2. relabel open issues: exactly one `status:` each, computed from the sub-issue graph and
#      the native blockers; `ready-for-agent` removed everywhere
#   3. delete every label outside the protocol
#   4. assert the invariants the sweeper will enforce (after --apply only)
#
# bash 3.2 (macOS) compatible: no mapfile, no $'\u...'.
set -euo pipefail

REPO=${GH_REPO:-design4pro/money-tracker.online}
APPLY=0
case "${1:-}" in
  --apply) APPLY=1 ;;
  "" | --dry-run) ;;
  *) echo "usage: $0 [--dry-run|--apply]" >&2; exit 2 ;;
esac

# The protocol's whole vocabulary. Anything else is deleted in step 3.
KEEP='status: triage
status: needs-info
status: backlog
status: queued
status: ready
status: in-progress
status: review
status: needs-human
run: triage
run: implement
type: bug
type: feature
type: enhancement
type: maintenance
prd
auto-advance
agent-pr
agent-docs'

# `status: in progress` followed by U+FE0F (bytes EF B8 8F): the label whose name cannot be typed.
IN_PROGRESS_OLD=$(printf 'status: in progress\xEF\xB8\x8F')

# Labels step 2 strips from every open issue, so step 3 may delete them without a use count.
# The `priority:` family is here because the protocol has no priority axis and this repo, unlike
# the one the protocol came from, does carry them on open issues: they are stripped, not migrated.
#
# `needs-e2e` (ADR 0016) is the odd one out: it is a *pull-request* label, so step 2 finds nothing
# to strip and step 3's use count - `gh issue list`, which does not count pull requests - would
# read 0 and delete it anyway. Listing it here makes that deletion a decision somebody wrote down
# rather than a side effect of what `gh issue list` happens not to see.
CLEARED_BY_RELABEL='ready-for-agent
needs-e2e
visual-change-expected
status: pending
status: on hold
status: review needed
status: blocked
priority: critical
priority: high
priority: medium
priority: low'

FAILFLAG=$(mktemp)
LABELS_JSON=$(mktemp)
trap 'rm -f "$FAILFLAG" "$LABELS_JSON"' EXIT
say()  { printf '%s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*" >&2; }
fail() { printf 'FAIL %s\n' "$*" >&2; echo 1 > "$FAILFLAG"; }
run()  { if [ "$APPLY" = 1 ]; then say "+ $*"; "$@"; else say "  (dry) $*"; fi; }

labels_now() { gh label list --repo "$REPO" --limit 200 --json name --jq '.[].name'; }
has_label()  { printf '%s\n' "$LABELS" | grep -Fxq -- "$1"; }
in_list()    { printf '%s\n' "$2" | grep -Fxq -- "$1"; }

# ---- 0. snapshot ---------------------------------------------------------------------
SNAP_DIR=docs/agents/migration
STAMP=$(date -u +%Y-%m-%d)
mkdir -p "$SNAP_DIR"
# The first run of the day captures the pre-migration state; a rerun must not overwrite it.
[ -s "$SNAP_DIR/labels-$STAMP.json" ] ||
  gh label list --repo "$REPO" --limit 200 --json name,color,description > "$SNAP_DIR/labels-$STAMP.json"
[ -s "$SNAP_DIR/issues-$STAMP.json" ] ||
  gh issue list --repo "$REPO" --state all --limit 1000 --json number,title,state,labels,parent \
    --jq 'map({number, title, state, parent: (.parent.number // null), labels: [.labels[].name]})' \
    > "$SNAP_DIR/issues-$STAMP.json"
say "snapshot: $SNAP_DIR/{labels,issues}-$STAMP.json"
LABELS=$(labels_now)
gh label list --repo "$REPO" --limit 200 --json name,color,description > "$LABELS_JSON"

# ---- 1. rename, create, recolour -----------------------------------------------------
label_is() {
  jq -e --arg n "$1" --arg c "$2" --arg d "$3" \
    'any(.[]; .name == $n and (.color | ascii_downcase) == $c and .description == $d)' \
    "$LABELS_JSON" > /dev/null
}
# ensure_label NAME COLOR DESCRIPTION [OLD]: OLD is renamed to NAME while it still exists. When
# both exist (a partial earlier run) OLD's issues are moved onto NAME and OLD is deleted.
ensure_label() {
  local name=$1 color=$2 desc=$3 old=${4:-}
  if [ -n "$old" ] && has_label "$old"; then
    if has_label "$name"; then
      gh issue list --repo "$REPO" --state all --limit 1000 --label "$old" --json number --jq '.[].number' |
        while read -r n; do run gh issue edit "$n" --repo "$REPO" --add-label "$name" --remove-label "$old"; done
      run gh label delete "$old" --repo "$REPO" --yes
    else
      run gh label edit "$old" --repo "$REPO" --name "$name" --color "$color" --description "$desc"
      return
    fi
  fi
  if has_label "$name"; then
    label_is "$name" "$color" "$desc" || run gh label edit "$name" --repo "$REPO" --color "$color" --description "$desc"
  else
    run gh label create "$name" --repo "$REPO" --color "$color" --description "$desc"
  fi
}

say "== 1. labels"
ensure_label 'status: triage'      fef2c0 'New and untriaged; a triage run picks it up'                    'status: pending'
ensure_label 'status: needs-info'  fbca04 'Triage needs an answer from the reporter'                       'status: on hold'
ensure_label 'status: review'      5319e7 'An artefact (PR, spec, PRD, tickets) waits for a human'         'status: review needed'
ensure_label 'status: in-progress' 1d76db 'A run holds this issue; only a claim script writes it'          "$IN_PROGRESS_OLD"
ensure_label 'status: queued'      d4c5f9 'Ticket waiting on an open blocker'                              'status: blocked'
ensure_label 'status: backlog'     ededed 'Idea or feature waiting for a plan or a decision'
ensure_label 'status: ready'       0e8a16 'Specified and unblocked; run: implement may claim it'
ensure_label 'status: needs-human' e11d21 'A workflow could not finish; a human decides what happens next'
ensure_label 'run: triage'         f9a825 'Command: (re)triage this issue; the claim removes it'
ensure_label 'run: implement'      f9a825 'Command: implement this ticket; the claim removes it'
ensure_label 'type: bug'           d73a4a 'App is not working correctly'
ensure_label 'type: feature'       1d76db 'New capability; needs a spec and a PRD before tickets'
ensure_label 'type: enhancement'   84b6eb 'Improvement upon an existing feature'
ensure_label 'type: maintenance'   c2e0c6 'Internal work with no user-visible behaviour change'
ensure_label 'prd'                 6f42c1 'Parent issue: title PRD:, body prd/v1, its sub-issues are the tickets'
ensure_label 'auto-advance'        8250df 'PRD only: the sweeper adds run: implement to each child as it unblocks'
ensure_label 'agent-pr'            0e8a16 'Draft PR opened by an implement run'
ensure_label 'agent-docs'          c5def5 'PR carrying CONTEXT.md or ADR changes from a plan run'
[ "$APPLY" = 1 ] && LABELS=$(labels_now)

# ---- 2. relabel open issues -----------------------------------------------------------
# Old names still show up in a dry run (nothing was renamed), so map them to the new ones first.
canon() {
  case "$1" in
    'status: pending') echo 'status: triage' ;;
    'status: on hold') echo 'status: needs-info' ;;
    'status: review needed') echo 'status: review' ;;
    "$IN_PROGRESS_OLD") echo 'status: in-progress' ;;
    'status: blocked') echo 'status: queued' ;;
    *) echo "$1" ;;
  esac
}
open_blockers() {
  gh issue view "$1" --repo "$REPO" --json blockedBy --jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'
}

say "== 2. open issues"
ISSUES=$(gh issue list --repo "$REPO" --state open --limit 1000 --json number,labels,parent \
  --jq '.[] | "\(.number)\t\(.parent.number // "-")\t\([.labels[].name] | join("|"))"')
PARENTS=$(printf '%s\n' "$ISSUES" | cut -f2 | grep -v '^-$' | sort -u || true)

printf '%s\n' "$ISSUES" | while IFS="$(printf '\t')" read -r n parent labels; do
  raw=$(printf '%s' "$labels" | tr '|' '\n')
  statuses=$(printf '%s\n' "$raw" | while read -r l; do [ -n "$l" ] && canon "$l"; done | grep '^status: ' | sort -u || true)
  had_ready=0; printf '%s\n' "$raw" | grep -Fxq 'ready-for-agent' && had_ready=1
  add=''; remove=''
  if in_list "$n" "$PARENTS"; then
    target='status: in-progress'
    printf '%s\n' "$raw" | grep -Fxq 'prd' || add="$add|prd"
  elif [ "$parent" != '-' ]; then
    case "$statuses" in
      'status: in-progress' | 'status: review' | 'status: needs-human') target=$statuses ;;
      *) if [ "$(open_blockers "$n")" -gt 0 ]; then target='status: queued'; else target='status: ready'; fi ;;
    esac
  else
    if [ "$had_ready" = 1 ]; then
      target='status: ready'
    elif [ -z "$statuses" ]; then
      target='status: triage'
    elif [ "$(printf '%s\n' "$statuses" | wc -l)" -eq 1 ]; then
      target=$statuses
    else
      target=$(printf '%s\n' "$statuses" | head -1)
      warn "#$n carries several statuses ($(printf '%s' "$statuses" | tr '\n' ',')); keeping $target"
    fi
    printf '%s\n' "$raw" | grep -q '^type: ' || warn "#$n has no parent and no type: label (add one by hand)"
  fi
  printf '%s\n' "$raw" | grep -Fxq -- "$target" || add="$add|$target"
  while read -r l; do
    [ -z "$l" ] && continue
    case "$l" in
      "$target") ;;
      status:*) remove="$remove|$l" ;;
      ready-for-agent) remove="$remove|$l" ;;
      visual-change-expected) remove="$remove|$l"; warn "#$n: visual-change-expected removed; declare it in the body (## Visual change expected)" ;;
      'priority: '*) remove="$remove|$l"; warn "#$n: $l removed; the protocol has no priority axis (ADR 0014)" ;;
    esac
  done <<< "$raw"
  # `canon` may map an old name onto the target: then the rename in step 1 already did the work.
  if [ -n "$add$remove" ]; then
    set -- gh issue edit "$n" --repo "$REPO"
    old_ifs=$IFS; IFS='|'
    for l in $add; do [ -n "$l" ] && set -- "$@" --add-label "$l"; done
    for l in $remove; do [ -n "$l" ] && set -- "$@" --remove-label "$l"; done
    IFS=$old_ifs
    run "$@"
  fi
done

# ---- 3. delete everything outside the protocol -------------------------------------
say "== 3. delete"
[ "$APPLY" = 1 ] && LABELS=$(labels_now)
printf '%s\n' "$LABELS" | while read -r l; do
  [ -z "$l" ] && continue
  in_list "$l" "$KEEP" && continue
  if in_list "$l" "$CLEARED_BY_RELABEL" || [ "$l" = "$IN_PROGRESS_OLD" ]; then
    run gh label delete "$l" --repo "$REPO" --yes
    continue
  fi
  open=$(gh issue list --repo "$REPO" --state open --limit 1000 --label "$l" --json number --jq 'length')
  if [ "$open" -eq 0 ]; then
    run gh label delete "$l" --repo "$REPO" --yes
  else
    fail "label '$l' is still on $open open issue(s); not deleted"
  fi
done

# ---- 4. verify ----------------------------------------------------------------------
if [ "$APPLY" != 1 ]; then
  say "== 4. verify: skipped in dry run"
  exit 0
fi
say "== 4. verify"
LABELS=$(labels_now)
printf '%s\n' "$LABELS" | grep -q "$(printf '\xEF\xB8\x8F')" && fail 'a label still carries U+FE0F'
printf '%s\n' "$LABELS" | grep -Fxq 'ready-for-agent' && fail 'ready-for-agent still exists'
printf '%s\n' "$LABELS" | grep -q '^priority: ' && fail 'a priority: label still exists'
printf '%s\n' "$LABELS" | grep -Fxq 'needs-e2e' && fail 'needs-e2e still exists (ADR 0016)'
printf '%s\n' "$LABELS" | while read -r l; do
  [ -n "$l" ] && ! in_list "$l" "$KEEP" && fail "label outside the protocol survived: $l" || true
done
gh issue list --repo "$REPO" --state open --limit 1000 --json number,labels,parent \
  --jq '.[] | "\(.number)\t\(.parent.number // "-")\t\([.labels[].name] | join("|"))"' |
  while IFS="$(printf '\t')" read -r n parent labels; do
    count=$(printf '%s' "$labels" | tr '|' '\n' | grep -c '^status: ' || true)
    [ "$count" -eq 1 ] || fail "#$n has $count status labels"
    if [ "$parent" = '-' ]; then
      printf '%s' "$labels" | tr '|' '\n' | grep -q '^type: ' || fail "#$n has no type: label"
    fi
    printf '%s' "$labels" | tr '|' '\n' | grep -Fxq 'run: triage' && warn "#$n carries run: triage before automations exist" || true
  done
if [ -s "$FAILFLAG" ]; then exit 1; fi
say "ok"
