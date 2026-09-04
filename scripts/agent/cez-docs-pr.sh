#!/usr/bin/env bash
# A plan run may change the domain vocabulary (CONTEXT.md) or record a decision (docs/adr/).
# Those commits never ride the run's own branch: this script cherry-picks them onto
# `claude/docs-<issue>-<run8>` cut from origin/develop and opens a draft PR labelled
# `agent-docs` that refers to (never closes) the issue. Nothing to publish exits 0.
set -euo pipefail
. "$(dirname "$0")/cez-lib.sh"

N=$(issue_number) || die "no issue pinned for this run (.agent/issue)"
BASE="${CEZ_BASE_BRANCH:-develop}"
BRANCH="claude/docs-$N-$RUN8"

git fetch --quiet origin "$BASE"
MERGE_BASE=$(git merge-base HEAD "origin/$BASE")
COMMITS=$(git rev-list --reverse "$MERGE_BASE..HEAD")
if [ -z "$COMMITS" ]; then
  say "==> no commits on top of origin/$BASE; nothing to publish"
  exit 0
fi
for c in $COMMITS; do
  for f in $(git diff-tree --no-commit-id --name-only -r "$c"); do
    case "$f" in
      CONTEXT.md|docs/adr/*) ;;
      *) die "commit ${c:0:8} touches $f; a plan run commits only CONTEXT.md and docs/adr/" ;;
    esac
  done
done

TMP=$(mktemp -d "${TMPDIR:-/tmp}/docs-pr.XXXXXX")
cleanup() { git worktree remove --force "$TMP" 2>/dev/null || true; rmdir "$TMP" 2>/dev/null || true; }
trap cleanup EXIT
say "==> $BRANCH from origin/$BASE"
git worktree add --quiet "$TMP" -B "$BRANCH" "origin/$BASE"
# shellcheck disable=SC2086
git -C "$TMP" cherry-pick --quiet $COMMITS
git -C "$TMP" push --quiet --force-with-lease --set-upstream origin "$BRANCH"

EXISTING=$(gh pr list --repo "$REPO" --head "$BRANCH" --state open --json number --jq '.[0].number // empty')
if [ -n "$EXISTING" ]; then
  say "==> PR #$EXISTING already open for $BRANCH; branch updated"
  exit 0
fi

ISSUE_TITLE=$(gh_issue_json "$N" title --jq .title)
BODY=$(mktemp "${TMPDIR:-/tmp}/docs-pr-body.XXXXXX")
{
  printf 'Refs #%s\n\nDomain documentation from the plan run `%s` for **%s**:\n\n' "$N" "$RUN8" "$ISSUE_TITLE"
  git log --reverse --format='- %s' "$MERGE_BASE..HEAD"
  printf '\n<!-- agent-run: %s -->\n' "$RUN_ID"
} | neutralise > "$BODY"
TITLE=$(printf 'docs: domain notes for #%s' "$N")
gh pr create --repo "$REPO" --draft --base "$BASE" --head "$BRANCH" --label agent-docs \
  --title "$TITLE" --body-file "$BODY"
rm -f "$BODY"
