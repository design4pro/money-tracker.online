#!/usr/bin/env bash
# Check nodes of a cezar workflow, measured against the base branch instead of HEAD.
#
#   bash .ai/scripts/branch-vs-base.sh files        # paths the branch changed, plus untracked ones
#   bash .ai/scripts/branch-vs-base.sh ahead        # exit 0 when the branch holds a commit of its own
#   bash .ai/scripts/branch-vs-base.sh test-guard   # exit 1 when the branch weakens a test or a check
#
# Why not `git diff HEAD` or `git status`: cezar autosave-commits the worktree before every check
# node, so by the time a check runs the agent's work is already committed and both are empty. A
# guard written on either one passes everything (probed on cezar 0.15.2, PR #750 review). The merge
# base with the base branch does not move when the agent commits, so it sees the whole change.
#
# The base is `CEZ_BASE`, which cezar sets for check nodes, then `develop` (`baseBranch` in
# `.ai/agentic.config.json`). `origin/<base>` is preferred over the local ref because the local one
# is whatever the clone last checked out.
set -euo pipefail

base="${CEZ_BASE:-develop}"
ref="origin/$base"
git rev-parse --verify -q "$ref^{commit}" >/dev/null || ref="$base"
mb=$(git merge-base HEAD "$ref") || { echo "no merge base between HEAD and $ref" >&2; exit 2; }

case "${1:-}" in
  files)
    { git diff --name-only "$mb"; git ls-files --others --exclude-standard; } | sort -u
    ;;
  ahead)
    [ "$(git rev-list --count "$mb"..HEAD)" -gt 0 ]
    ;;
  test-guard)
    # AGENTS.md, Never: no deleted test, no .skip/.only/.todo/.fixme, no lint or type suppression.
    # `git add -A` first so a new, untracked file is part of the diff.
    git add -A
    del=$(git diff "$mb" --name-only --diff-filter=D | grep -Ei '(^|/)(tests?|__tests__|e2e)/|\.(test|spec)\.' || true)
    skip=$(git diff "$mb" -U0 | grep -E '^\+[^+]' | grep -E '\.(skip|only|todo|fixme)\(|(^|[^A-Za-z])(xit|xdescribe|xtest)\(|eslint-disable|oxlint-disable|@ts-ignore|@ts-expect-error' || true)
    if [ -n "$del$skip" ]; then echo "Test weakening detected:"; echo "$del"; echo "$skip"; exit 1; fi
    ;;
  *)
    echo "usage: branch-vs-base.sh files|ahead|test-guard" >&2
    exit 2
    ;;
esac
