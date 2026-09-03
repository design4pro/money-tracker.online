#!/usr/bin/env bash
# Read-only window onto the GitHub REST API for agent steps. The allowlist entry is the
# script name, so the whole argument space must be safe: only GET, only this repository,
# only the resources a triage or plan step needs. `gh api` turns any -f/-F/--input into a
# POST, so those flags are refused along with --method.
#
#   scripts/agent/gh-ro.sh <path> [--paginate] [--jq <expr>]
#   e.g. gh-ro.sh issues/123/timeline --paginate
set -euo pipefail
REPO="${GH_REPO:-design4pro/money-tracker.online}"

path="${1:-}"
[ -n "$path" ] || { echo "usage: gh-ro.sh <path-under-repos/$REPO> [--paginate] [--jq <expr>]" >&2; exit 2; }
shift

case "$path" in
  repos/*) path="${path#repos/$REPO/}" ;;
esac
if ! printf '%s' "$path" | grep -qE '^(issues|pulls|labels|commits|compare|contents|git/ref|search)(/[A-Za-z0-9._%:/-]*)?(\?[A-Za-z0-9=&%._+:-]*)?$'; then
  echo "gh-ro.sh: path not allowed: $path" >&2
  exit 2
fi
case "$path" in *..*) echo "gh-ro.sh: path not allowed: $path" >&2; exit 2 ;; esac

args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --paginate) args+=("$1"); shift ;;
    --jq|-q) [ $# -ge 2 ] || exit 2; args+=("--jq" "$2"); shift 2 ;;
    *) echo "gh-ro.sh: flag not allowed: $1" >&2; exit 2 ;;
  esac
done

exec gh api --method GET "repos/$REPO/$path" ${args[@]+"${args[@]}"}
