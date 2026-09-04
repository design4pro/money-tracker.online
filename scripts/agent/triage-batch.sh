#!/usr/bin/env bash
# Operator: feed the `triage-relabel` automation from the backlog a few issues at a time. Adds
# `run: triage` to the oldest open `status: triage` issues that do not carry it yet; the claim
# step takes it from there. Nothing else changes, so a batch is safe to repeat.
#
#   scripts/agent/triage-batch.sh [--limit N] [--dry-run]
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

LIMIT=5
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) LIMIT="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) die "unknown flag: $1" ;;
  esac
done
case "$LIMIT" in ''|*[!0-9]*) die "--limit needs a number" ;; esac

QUEUE=$(gh issue list --repo "$REPO" --state open --label "status: triage" --limit 200 \
  --json number,labels,createdAt \
  --jq '[.[] | select(all(.labels[].name; . != "run: triage"))] | sort_by(.createdAt) | .[].number')
COUNT=0
for n in $QUEUE; do
  [ "$COUNT" -lt "$LIMIT" ] || break
  if [ "$DRY" -eq 1 ]; then say "would add run: triage to #$n"
  else gh issue edit "$n" --repo "$REPO" --add-label "run: triage" > /dev/null; say "run: triage -> #$n"; fi
  COUNT=$((COUNT + 1))
done
say "==> $COUNT issue(s) queued for triage ($(printf '%s\n' "$QUEUE" | grep -c . || true) waiting)"
