#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): auto-formats the edited file so formatting never consumes an
# agent turn or a CI run - `pnpm check` is a rung in the gate, and losing a whole round trip to a
# missing trailing comma is a waste of both.
#
# Always exits 0. The edit has already happened; a formatter that cannot run must not turn a good
# edit into a failed tool call.
set -uo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

[ -z "$file_path" ] && exit 0
[ -f "$file_path" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
pnpm exec prettier --write --ignore-unknown "$file_path" >/dev/null 2>&1 || true

exit 0
