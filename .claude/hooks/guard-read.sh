#!/usr/bin/env bash
# PreToolUse hook (Read|Glob|Grep), agent runs only (CEZ_TASK_ID or GITHUB_ACTIONS): an agent
# reads inside its own worktree and never the files that hold secrets or other runs' state.
# .ai/runs, .ai/analysis, .ai/qa and .ai/tmp stay readable: the om-* skills write their
# artefacts there; only the test-env credentials file under .ai/qa/ is denied.
# Contract: exit 2 blocks the tool call and feeds stderr back to the model; exit 0 allows.
set -euo pipefail

[ -n "${CEZ_TASK_ID:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ] || exit 0

input=$(cat)
target=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')
pattern=$(printf '%s' "$input" | jq -r '.tool_input.pattern // empty')

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
root=$(cd "$root" && pwd -P)

# Resolve to a physical path; a file that does not exist yet resolves through its parent.
resolve() {
  local p="$1" dir base
  case "$p" in /*) ;; *) p="$root/$p" ;; esac
  if [ -d "$p" ]; then
    (cd "$p" && pwd -P)
  else
    dir=$(dirname "$p"); base=$(basename "$p")
    [ -d "$dir" ] || { printf '%s\n' "$p"; return; }
    printf '%s/%s\n' "$(cd "$dir" && pwd -P)" "$base"
  fi
}

deny() {
  echo "BLOCKED (agent run): reading '$1' is outside what a run may see ($2)." >&2
  exit 2
}

check() { # path
  local abs rel
  # A `..` component cannot be resolved lexically when the directory does not exist, so
  # it is refused outright; a run names files by their plain path.
  case "$1" in ..|../*|*/..|*/../*) deny "$1" "outside the worktree" ;; esac
  abs=$(resolve "$1")
  case "$abs" in
    "$root"|"$root"/*) ;;
    *) deny "$1" "outside the worktree" ;;
  esac
  rel="${abs#"$root"/}"
  case "$rel" in
    .dev.vars*|*/.dev.vars*|.env|.env.*|*/.env|*/.env.*)
      case "$rel" in *.example) ;; *) deny "$1" "environment file" ;; esac ;;
  esac
  case "$rel" in
    .ai/cezar/runs*|.ai/cezar/worktrees*|.ai/cezar/tmp*) deny "$1" "cezar run state" ;;
    .ai/qa/test-env.env) deny "$1" "test-env credentials" ;;
    .git/*) deny "$1" "git internals" ;;
  esac
}

[ -n "$target" ] && check "$target"
# A Glob pattern that walks upwards or names a denied file is a read of it.
case "$pattern" in
  ../*|*/../*|/*) check "$pattern" ;;
  *.dev.vars*|*.env|*.env.*|*test-env.env*) deny "$pattern" "pattern names a protected file" ;;
esac

exit 0
