#!/usr/bin/env bash
# The PR `pr-to-merge` may check out and push to, by number. Prints its head branch, or refuses.
#
#   bash .ai/scripts/pr-guard.sh "$CEZ_GITHUB_NUMBER"
#
# Taken: an open PR from this repository (not a fork: `origin` is not the fork, and the push goes to
# `origin`) into the base branch from `.ai/agentic.config.json`, whose head is neither `main` nor the
# base branch. The head rule matters: a back-merge PR (`main` into `develop`) has `main` as its head,
# and `git push origin HEAD:refs/heads/main` after a sync would be the develop -> main promotion that
# only a person merges.
#
# Exit 1: refused. Exit 2: not a PR number. A `gh` failure stops the script (`set -e`), so it fails
# closed. The number is checked to be digits before it reaches a command line.
set -euo pipefail
cd "$(dirname "$0")/../.."

n="${1:-}"
case "$n" in
  '' | *[!0-9]*) echo "pr-guard: '$n' is not a PR number (pr-to-merge needs a GitHub automation that sets CEZ_GITHUB_NUMBER)" >&2; exit 2 ;;
esac

base=$(node -p 'require("./.ai/agentic.config.json").baseBranch')
meta=$(gh pr view "$n" --json state,baseRefName,isCrossRepository,headRefName --jq '"\(.state) \(.baseRefName) \(.isCrossRepository) \(.headRefName)"')
read -r state pbase cross head <<<"$meta" || true

refuse() { echo "pr-guard: refusing PR #$n ($meta)" >&2; exit 1; }
[ "$state" = OPEN ] && [ "$pbase" = "$base" ] && [ "$cross" = false ] || refuse
case "$head" in '' | main | "$base") refuse ;; esac

echo "$head"
