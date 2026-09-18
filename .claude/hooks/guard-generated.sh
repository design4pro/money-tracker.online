#!/usr/bin/env bash
# PreToolUse hook (Edit|Write): blocks hand-edits of generated files, and in agent runs
# (CEZ_TASK_ID or GITHUB_ACTIONS) writes outside the worktree and the paths that configure the
# agent itself (ADR 0017).
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

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
# Physical path, because the comparison below is only sound when both sides are spelled the same
# way. On macOS a worktree under $TMPDIR is reached through /var, a symlink to /private/var, and
# the tools hand back the resolved form - so an unresolved root reports every write as outside it,
# including the ones inside. A root that does not exist stays as written; a fixture may name one.
root=$(cd "$root" 2>/dev/null && pwd -P || printf '%s' "$root")

# Resolve to a physical path. A file being written usually does not exist yet, and often neither
# does its directory, so this walks up to the nearest ancestor that does and re-appends the rest.
# Resolving only the immediate parent is not enough: `mkdir -p`-style writes are the common case,
# and under $TMPDIR every one of them would come back unresolved and compare unequal to a root
# that is resolved - a new file in a new directory, refused for being outside the worktree it is
# plainly inside.
resolve() {
  local p="$1" dir tail=""
  case "$p" in /*) ;; *) p="$root/$p" ;; esac
  dir="$p"
  while [ ! -d "$dir" ]; do
    tail="${dir##*/}${tail:+/$tail}"
    dir="${dir%/*}"
    if [ -z "$dir" ]; then
      dir=/
      break
    fi
  done
  dir=$(cd "$dir" && pwd -P)
  # `/` would otherwise give a doubled separator. An `&&` one-liner here would be the `set -e`
  # trap: a false test makes the statement itself non-zero and kills the subshell mid-resolve.
  if [ "$dir" = / ]; then dir=""; fi
  if [ -z "$tail" ]; then
    printf '%s\n' "${dir:-/}"
  else
    printf '%s/%s\n' "$dir" "$tail"
  fi
}

deny_outside() { # reason
  echo "BLOCKED (agent run): '$file_path' $1. A run writes only inside the worktree it was given. A change that belongs to another repository - design4pro/agent-kit, say - is proposed there as a pull request from its own clone, never by editing a sibling working tree." >&2
  exit 2
}

# Confinement, and the first thing checked, because every rule below reasons about a path relative
# to the root and an outside path has no such form: `${file_path#"$root"/}` leaves it absolute, the
# anchored pattern cannot match an absolute path, and so the whole of this hook reads as "not
# guarded". A pr-autopilot run took `../agent-kit/templates/...` on exactly that route and rewrote
# eight files in a sibling checkout a human was working in, replacing template sources with one
# repository's render. Nothing downstream could tell: the next sync reported "no change".
#
# Edit and Write are what this covers, which is what that incident used. A Bash redirect still
# reaches outside - which paths a shell command writes is not a question a matcher can answer, and
# git-guardrails.sh says why at length - so this is the boundary for the file-writing tools rather
# than a sandbox.
#
# A `..` component is refused outright rather than resolved: it cannot be resolved lexically when
# the directory does not exist, and a run names files by their plain path.
case "$file_path" in ..|../*|*/..|*/../*) deny_outside "walks through '..'" ;; esac
abs=$(resolve "$file_path")
case "$abs" in
  "$root" | "$root"/*) ;;
  *) deny_outside "is outside the worktree" ;;
esac

# The agent's own configuration: hooks, settings, Cezar workflows, the om config, tracker and
# browser descriptors, the skill overrides and the validation entrypoints under .ai/scripts/ (a
# run must not rewrite its own gate). docs/agents/reference.md and out-of-scope.md are the
# clean-room rule and the product boundary, governance a run reads and never edits.
#
# .ai/agent-kit.lock.json is here because it is the root of trust for that gate and not merely
# another generated file. agent-kit-check.mjs proves nothing except that each file's hash equals
# the hash the lock states, so a run able to edit both edits the file and restates its hash in the
# same breath and the check still exits 0 - the one failure that leaves the gate looking green.
# Protecting the lock is what makes every hash in it mean something, the `watched` skills-lock.json
# entry included; that file stays editable so om-apply-upgrade-notes can still move it, and the
# lock is now what reports it when something else does.
#
# scripts/ci/ and the two docs/agents/cezar-*.json are the same argument one step out:
# review-threads-label.mjs is the single thing that arms "Resolve blocking review threads", and the two JSON files
# are what the cockpit installs as this repository's automations and prompts - a run rewriting the
# prompt it is about to be handed is the same act as a run rewriting .ai/cezar/.
rel="${abs#"$root"/}"

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

if printf '%s' "$rel" | grep -Eq '^(\.github/|\.claude/|\.husky/|\.ai/cezar/|\.ai/agentic\.config\.json$|\.ai/trackers/|\.ai/browsers/|\.ai/skills/|\.ai/scripts/|\.ai/agent-kit\.lock\.json$|scripts/ci/|docs/agents/cezar-(automations|prompt-templates)\.json$|\.npmrc$|pnpm-workspace\.yaml$|docs/agents/reference\.md$|docs/agents/out-of-scope\.md$)'; then
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
