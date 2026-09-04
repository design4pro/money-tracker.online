#!/usr/bin/env bash
# Shared helpers for the cezar-side scripts in scripts/agent/. Source it, never run it:
#
#   . "$(dirname "$0")/cez-lib.sh"
#
# What lives here is the plumbing every workflow script needs and nothing that decides
# state (decisions are in state.mjs, where vitest can reach them):
#   - repo / worktree / run identity (REPO, MAIN_ROOT, RUN_ID, issue_number)
#   - mkdir-based locks (macOS has no flock; a directory create is atomic everywhere)
#   - GitHub writes that neutralise @claude and upsert marker comments in place
#   - the heartbeat that the sweeper (I-6) reads
#
# Every script that sources this runs on the cezar host with the host's `gh` identity;
# the agent itself only reaches these scripts through the workflow's bashAllowlist.
set -euo pipefail

REPO="${GH_REPO:-design4pro/money-tracker.online}"
AGENT_DIR=".agent"
ZWSP=$'\xe2\x80\x8b' # U+200B, the zero-width space that defuses @claude

say() { printf '%s\n' "$*" >&2; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Main checkout root, also from inside a `cez/<id8>` worktree (the common git dir lives there).
main_root() {
  local common
  common=$(git rev-parse --git-common-dir)
  case "$common" in
    /*) dirname "$common" ;;
    *) dirname "$(cd "$(git rev-parse --show-toplevel)" && cd "$common" && pwd -P)" ;;
  esac
}
MAIN_ROOT=$(main_root)

# Run id: cezar exports CEZ_TASK_ID to the agent; command steps fall back to the worktree
# basename, which cezar names after the run id (.ai/cezar/worktrees/<runId>).
run_id() {
  if [ -n "${CEZ_TASK_ID:-}" ]; then printf '%s\n' "$CEZ_TASK_ID"; return; fi
  local top; top=$(git rev-parse --show-toplevel)
  case "$top" in
    */.ai/cezar/worktrees/*) basename "$top" ;;
    *) printf 'local\n' ;;
  esac
}
RUN_ID=$(run_id)
RUN8=${RUN_ID:0:8}

# The task text cezar stored for this run (`.ai/cezar/runs.json` is a JSON index keyed by id;
# the task is the first line of the prompt the automation or the cockpit sent).
run_task() {
  local index="$MAIN_ROOT/.ai/cezar/runs.json"
  [ -s "$index" ] || return 1
  jq -r --arg id "$RUN_ID" '
    (if type == "array" then . else (.runs // (to_entries | map(.value))) end)
    | map(select(.id == $id)) | .[0].task // empty' "$index" 2>/dev/null
}

# First integer in a text is the issue number; everything after it is untrusted.
issue_from_text() { printf '%s\n' "$1" | grep -oE '[0-9]+' | head -1; }

# Issue this run works on: the pinned file wins (claim writes it), then the run's task.
issue_number() {
  if [ -s "$AGENT_DIR/issue" ]; then cat "$AGENT_DIR/issue"; return; fi
  local task; task=$(run_task || true)
  [ -n "$task" ] || return 1
  issue_from_text "$task"
}

# ---------------------------------------------------------------------------
# Locks. `mkdir` is atomic on every filesystem we run on; the pid inside lets a
# later run reclaim a lock whose owner died. Locks live in the main checkout so
# every worktree on the host shares them.
LOCK_ROOT="${CEZ_LOCK_DIR:-$MAIN_ROOT/.ai/cezar/tmp/locks}"

lock_acquire() { # name [tries]
  local name="$1" tries="${2:-1}" dir owner i
  dir="$LOCK_ROOT/$name.lock"
  mkdir -p "$LOCK_ROOT"
  for ((i = 0; i < tries; i++)); do
    if mkdir "$dir" 2>/dev/null; then
      printf '%s\n' "$$" > "$dir/pid"
      return 0
    fi
    owner=$(cat "$dir/pid" 2>/dev/null || true)
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      rm -rf "$dir" # stale: the holder is gone
      continue
    fi
    [ "$tries" -gt 1 ] && sleep 1
  done
  return 1
}

lock_release() { # name
  local dir="$LOCK_ROOT/$1.lock"
  [ "$(cat "$dir/pid" 2>/dev/null || true)" = "$$" ] && rm -rf "$dir"
  return 0
}

# ---------------------------------------------------------------------------
# GitHub. Every byte of agent text that reaches GitHub passes through neutralise, so a
# run can never summon the claude-code-action from an issue or PR body.
neutralise() { sed "s/@claude/@${ZWSP}claude/g"; }

gh_issue_json() { # number fields [gh flags...]
  local n="$1"
  shift
  gh issue view "$n" --repo "$REPO" --json "$@"
}

issue_status() { # number -> "status: x" or empty
  gh_issue_json "$1" labels --jq '[.labels[].name | select(startswith("status: "))] | .[0] // empty'
}

# One `gh issue edit` swaps the status label so no observer sees zero or two of them.
swap_status() { # number "status: new"
  local n="$1" new="$2" current args=()
  current=$(issue_status "$n")
  [ "$current" = "$new" ] && return 0
  [ -n "$current" ] && args+=(--remove-label "$current")
  gh issue edit "$n" --repo "$REPO" --add-label "$new" ${args[@]+"${args[@]}"} > /dev/null
}

# Find the id of the comment carrying a marker (first match, oldest first). The marker is
# inlined into the filter: `gh api --jq` takes one argument and has no `--arg`, and no marker
# carries a quote.
comment_id_by_marker() { # number marker
  gh api --paginate "repos/$REPO/issues/$1/comments" \
    --jq ".[] | select(.body | contains(\"$2\")) | .id" | head -1
}

# Create or edit in place the comment identified by marker. Body from stdin.
comment_upsert() { # number marker
  local n="$1" marker="$2" body id
  body=$(neutralise)
  case "$body" in *"$marker"*) ;; *) body="$marker"$'\n'"$body" ;; esac
  id=$(comment_id_by_marker "$n" "$marker")
  if [ -n "$id" ]; then
    gh api --method PATCH "repos/$REPO/issues/comments/$id" -f body="$body" > /dev/null
  else
    gh api --method POST "repos/$REPO/issues/$n/comments" -f body="$body" > /dev/null
  fi
}

# Heartbeat: rewrite the timestamp line inside this run's claim comment. A missing claim
# (phase-2 dry runs, local use) is not an error; the sweeper simply sees no heartbeat.
heartbeat() { # [number]
  local n="${1:-$(issue_number || true)}" id body stamp
  [ -n "$n" ] || return 0
  id=$(comment_id_by_marker "$n" "<!-- agent-claim: $RUN_ID -->")
  [ -n "$id" ] || { warn "no claim comment for #$n and run $RUN8; heartbeat skipped"; return 0; }
  stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  body=$(gh api "repos/$REPO/issues/comments/$id" --jq .body)
  if printf '%s' "$body" | grep -q '<!-- agent-heartbeat: '; then
    body=$(printf '%s' "$body" | sed -E "s/<!-- agent-heartbeat: [^>]*-->/<!-- agent-heartbeat: $stamp -->/")
  else
    body="$body"$'\n'"<!-- agent-heartbeat: $stamp -->"
  fi
  gh api --method PATCH "repos/$REPO/issues/comments/$id" -f body="$body" > /dev/null
}

# Repo code (install, dev server, seed, tests, build) runs with a scrubbed environment so
# nothing the host holds leaks into a test or a postinstall. Extra KEY=VALUE pairs go first.
clean_env() { # [KEY=VALUE ...] -- command...
  local pass=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do pass+=("$1"); shift; done
  [ "${1:-}" = "--" ] && shift
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-C.UTF-8}" \
    ${CI:+CI="$CI"} ${pass[@]+"${pass[@]}"} "$@"
}

# The published body keeps the human's original request: the first publish wraps the body
# as it was in <details>, later publishes carry that block forward. Prints the assembled body.
plan_body_with_original() { # draft-file current-body
  local file="$1" current="$2" details
  if grep -q '<details>' "$file"; then cat "$file"; return; fi
  case "$current" in
    "<!-- schema: "*) details=$(printf '%s\n' "$current" | sed -n '/<details>/,/<\/details>/p') ;;
    *) details=$(printf '<details><summary>Original request</summary>\n\n%s\n\n</details>' "$current") ;;
  esac
  head -1 "$file"
  printf '\n%s\n\n' "$details"
  tail -n +2 "$file"
}

# The tree id of the working tree as it would be committed (tracked + untracked, minus
# ignored). The ladder records it and the handback compares, so a verdict never vouches for
# a tree it did not see; a commit that changes nothing keeps the same id.
worktree_tree_id() {
  local index
  index=$(mktemp "${TMPDIR:-/tmp}/tree-index.XXXXXX")
  GIT_INDEX_FILE="$index" git read-tree HEAD 2>/dev/null || true
  GIT_INDEX_FILE="$index" git add -A
  GIT_INDEX_FILE="$index" git write-tree
  rm -f "$index"
}

# The `agent-pr` and protected-path rules read the run's diff against the base.
diff_base() { git merge-base HEAD "origin/${CEZ_BASE_BRANCH:-develop}"; }
# shellcheck disable=SC2034  # read by cez-claim.sh and cez-handback.sh
PROTECTED_PATH_RE='^(\.github/|\.claude/|\.husky/|\.ai/cezar/|scripts/agent/|\.npmrc$|pnpm-workspace\.yaml$)'
