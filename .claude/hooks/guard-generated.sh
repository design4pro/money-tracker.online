#!/usr/bin/env bash
# PreToolUse hook (Edit|Write). Three layers, narrowest first (ADR 0017, ADR 0021):
#
#   1. Generated files, for everyone. Each has a generator and the generator is the source of
#      truth. A hand-edit survives exactly until the next run of it, and in between produces the
#      worst kind of failure: one that reproduces on one machine and not another.
#   2. Worktree confinement, in agent runs (CEZ_TASK_ID or GITHUB_ACTIONS). No '..', nothing
#      outside the worktree the run was given.
#   3. The paths that configure the agent, under GITHUB_ACTIONS only and without exception.
#
# A fourth layer used to sit beside the third: the same governance block in a cezar run, with an
# escape hatch for a file the branch already changed. It is gone (ADR 0021). A cezar run edits its
# own skills, workflows and gate in one commit on a branch, like any other change here; the diff is
# a human's to read and the review is where it is caught. What made that layer removable is exactly
# what makes layer 3 non-negotiable: under GitHub Actions the diff belongs to whoever opened the
# pull request, so "this branch already changes it" is the attacker's own claim and a review run
# with a write token must not be talked into rewriting git-guardrails.sh mid-run.
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
    # Not 'run wrangler types': this file is hand-authored to mirror wrangler.jsonc (its own header
    # says why), and 'wrangler types' refuses to write it at all - 'A non-Wrangler
    # worker-configuration.d.ts already exists'. It is blocked because it must be changed together
    # with the config it mirrors, in a diff a human reads, not because a command regenerates it.
    echo "BLOCKED: worker-configuration.d.ts mirrors the bindings in wrangler.jsonc by hand, and the two move together. Change wrangler.jsonc first, then edit this file in the same change, and say in the PR that you did - do NOT run 'wrangler types', which refuses this file." >&2
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
  echo "BLOCKED (agent run): '$file_path' $1. A run writes only inside the worktree it was given. A change that belongs to another repository - design4pro/cezar, say - is proposed there as a pull request from its own clone, never by editing a sibling working tree." >&2
  exit 2
}

# Confinement, and the first thing checked, because every rule below reasons about a path relative
# to the root and an outside path has no such form: `${file_path#"$root"/}` leaves it absolute, the
# anchored pattern cannot match an absolute path, and so the whole of this hook reads as "not
# guarded". A pr-autopilot run took `../agent-kit/templates/...` on exactly that route and rewrote
# eight files in a sibling checkout a human was working in, replacing template sources with one
# repository's render. Nothing downstream could tell: the next sync reported "no change". That
# repository is archived now; the route it was reached by is not, and this layer has no replacement
# anywhere else.
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

# Layer 3 ends here for a cezar run: a run under CEZ_TASK_ID may edit the paths below, and the
# review of its branch is what judges that. Everything from here is GitHub Actions only.
[ -n "${GITHUB_ACTIONS:-}" ] || exit 0

# The agent's own configuration: hooks, settings, Cezar workflows, the om config, tracker and
# browser descriptors, the skill overrides and the validation entrypoints under .ai/scripts/ (a
# run must not rewrite its own gate). docs/agents/reference.md and out-of-scope.md are the
# clean-room rule and the product boundary, governance a run reads and never edits.
#
# scripts/ci/ and the two docs/agents/cezar-*.json are the same argument one step out:
# review-threads-label.mjs is the single thing that arms "Resolve blocking review threads", and the two JSON files
# are what the cockpit installs as this repository's automations and prompts - a run rewriting the
# prompt it is about to be handed is the same act as a run rewriting .ai/cezar/.
#
# Why this is absolute here and nowhere else: the review job reads a pull request's contents with a
# write token, and that pull request may have been opened by anyone. Its diff, its instructions and
# its files are the untrusted input. A run that can be persuaded to edit git-guardrails.sh,
# merge-gate.mjs or .github/workflows/ is a run that can be persuaded to disarm the very checks
# reading it, in the same job, before anything downstream sees the change.
rel="${abs#"$root"/}"

if printf '%s' "$rel" | grep -Eq '^(\.github/|\.claude/|\.husky/|\.ai/cezar/|\.ai/agentic\.config\.json$|\.ai/trackers/|\.ai/browsers/|\.ai/skills/|\.ai/scripts/|scripts/ci/|docs/agents/cezar-(automations|prompt-templates)\.json$|\.npmrc$|pnpm-workspace\.yaml$|docs/agents/reference\.md$|docs/agents/out-of-scope\.md$)'; then
  echo "BLOCKED (GitHub Actions): '$rel' configures the agent, and under GitHub Actions the diff being read is the pull request author's. A run here never edits it. Note it under 'Noticed but not touching' and carry on; if the change is right, it belongs on a branch a human opens." >&2
  exit 2
fi

exit 0
