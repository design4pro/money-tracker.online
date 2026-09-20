#!/usr/bin/env bash
# Start one `housekeeping` run (.ai/cezar/workflows/housekeeping.yml) on the cezar cockpit of
# this host. launchd calls it three times a day (.ai/scripts/launchd/); a human may call it any
# time. Cezar has no scheduler of its own, so this POST is the schedule (ADR 0017).
#
#   .ai/scripts/housekeeping.sh
#
# Env: CEZ_API (default http://localhost:4321), CEZ_PROJECT (default money-tracker-online).
# Exactly one run per call: a reachable cockpit is the authority, whatever it answers (a 2xx is
# queued; anything else is an error that ends this script non-zero, never a second run beside
# it). Only when nothing answers at all (curl cannot connect) does the work move to a headless
# `cezar run` in the main checkout; that run still lands in the cockpit's history, it just does
# not share its queue.
set -euo pipefail

API="${CEZ_API:-http://localhost:4321}/api/v1/p/${CEZ_PROJECT:-money-tracker-online}/runs"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BODY='{"workflow":"housekeeping","task":"housekeeping","worktree":true,"autonomous":true,"variants":1,"generateFollowups":false}'

rc=0
out=$(curl -sS --max-time 10 -X POST "$API" -H 'content-type: application/json' -d "$BODY" -w '\n%{http_code}') || rc=$?
case "$rc" in
  0)
    code=$(tail -1 <<<"$out")
    case "$code" in
      2??) printf 'housekeeping queued: %s\n' "$(sed '$d' <<<"$out" | jq -r '.run.id // .id // "?"' 2>/dev/null)"; exit 0 ;;
      *) printf 'POST %s -> %s: %s\n' "$API" "$code" "$(sed '$d' <<<"$out")" >&2; exit 1 ;;
    esac ;;
  # curl 6 = could not resolve host, 7 = could not connect: nothing is listening. Anything else
  # (28 = timeout above all: the cockpit may have queued the run and answered slowly) is a
  # failure to report, never a reason to start a second run beside a possible first.
  6|7) printf 'cockpit unreachable at %s (curl %s), running headless\n' "$API" "$rc" >&2 ;;
  *) printf 'POST %s failed (curl %s); not falling back, the run may have been queued\n' "$API" "$rc" >&2; exit 1 ;;
esac

cd "$ROOT"
# The headless fallback runs the cockpit's own binary: the design4pro/cezar fork, linked onto PATH
# from its checkout. There is deliberately no npx form. `npx @open-mercato/cezar` installs upstream,
# which lacks the fork's fixes and says nothing about it, and this line runs precisely when the
# cockpit is already unreachable - the worst moment to start a run on a different cezar.
if ! command -v cezar >/dev/null 2>&1; then
  echo 'cezar is not on PATH; install the design4pro/cezar fork (its docs/host/README.md)' >&2
  exit 1
fi
exec cezar run "housekeeping" --workflow housekeeping
