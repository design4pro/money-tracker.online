#!/usr/bin/env bash
# PreToolUse hook (Edit|Write): blocks hand-edits of generated files, and in agent runs
# (CEZ_TASK_ID or GITHUB_ACTIONS) the paths that configure the agent itself (ADR 0017).
#
# Each of these has a generator, and the generator is the source of truth. A hand-edit survives
# exactly until the next run of it, and in between produces the worst kind of failure: one that
# reproduces on one machine and not another.
#
# Contract: exit 2 blocks the tool call and feeds stderr back to the model; exit 0 allows.
set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

[ -z "$file_path" ] && exit 0

case "$file_path" in
  */src/routeTree.gen.ts)
    echo "BLOCKED: src/routeTree.gen.ts is generated from the files under src/routes. Run 'pnpm generate-routes' instead of editing it." >&2
    exit 2
    ;;
  */drizzle/*.sql | */drizzle/meta/*)
    echo "BLOCKED: drizzle/ is generated from src/server/db/*-schema.ts. Change the schema and run 'pnpm db:generate' instead of editing SQL or the journal by hand - a hand-written migration is invisible to the drift check in CI, and migrations must stay additive." >&2
    exit 2
    ;;
  */worker-configuration.d.ts)
    echo "BLOCKED: worker-configuration.d.ts is generated from wrangler.jsonc. Change the bindings there and run 'pnpm exec wrangler types' instead of editing it." >&2
    exit 2
    ;;
esac

[ -n "${CEZ_TASK_ID:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ] || exit 0

# The agent's own configuration: hooks, settings, Cezar workflows, the om config, tracker and
# browser descriptors, the skill overrides and the validation entrypoints under .ai/scripts/ (a
# run must not rewrite its own gate). docs/agents/reference.md and out-of-scope.md are the
# clean-room rule and the product boundary, governance a run reads and never edits.
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
rel="${file_path#"$root"/}"

# True when the branch already changes this path relative to its base. Fails closed: no git, no
# base ref, no match - the caller treats the file as untouched and the block stands.
in_branch_diff() {
  base=$(jq -r '.baseBranch // empty' "$root/.ai/agentic.config.json" 2>/dev/null) || return 1
  [ -n "$base" ] || return 1
  changed=$(git -C "$root" diff --name-only "origin/$base...HEAD" 2>/dev/null) || return 1
  # Not a pipe: `grep -q` closes early, and under `pipefail` that SIGPIPEs the writer and turns a
  # match into a non-zero pipeline - the one shape of this test that fails open-looking and blocks.
  grep -Fxq "$1" <<< "$changed"
}

if printf '%s' "$rel" | grep -Eq '^(\.github/|\.claude/|\.husky/|\.ai/cezar/|\.ai/agentic\.config\.json$|\.ai/trackers/|\.ai/browsers/|\.ai/skills/|\.ai/scripts/|\.npmrc$|pnpm-workspace\.yaml$|docs/agents/reference\.md$|docs/agents/out-of-scope\.md$)'; then
  # One exception, and only for a cezar run: a file the branch already changes. A reviewer asking
  # for a correction to a change a human proposed is not a run rewriting its own rules, and
  # refusing it is how a review thread stays open forever - the `develop` ruleset merges nothing
  # with one, so the block turns a one-line correction into a permanent stall. Introducing a
  # change to a guarded file the branch does not already carry stays refused: that is the case
  # this rule exists for.
  #
  # Never under GITHUB_ACTIONS. There the diff is the attacker's, so "the branch already changes
  # it" is a claim the attacker made, and the block is absolute.
  if [ -z "${GITHUB_ACTIONS:-}" ] && in_branch_diff "$rel"; then
    exit 0
  fi
  echo "BLOCKED (agent run): '$rel' configures the agent; a run never edits it. Note it under 'Noticed but not touching' and carry on." >&2
  exit 2
fi

exit 0
