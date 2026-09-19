#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): auto-formats the edited file so formatting is fixed on the way
# in - a stray reformat never shows up as diff noise in review, and never costs a round trip of
# its own.
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
