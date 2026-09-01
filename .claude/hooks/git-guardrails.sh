#!/usr/bin/env bash
# PreToolUse hook (Bash): blocks destructive git commands.
#
# Everything here destroys work that is not recoverable from the reflog by someone who does not
# already know to look. `develop` and `main` are the shared branches - staging and production
# respectively - so a force-push to either is a rewrite of what somebody else has already pulled.
#
# Contract: exit 2 blocks the tool call and feeds stderr back to the model; exit 0 allows.
set -euo pipefail

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

[ -z "$command" ] && exit 0

block() {
  echo "BLOCKED: '$command' matches dangerous pattern '$1'. The user has prevented you from doing this." >&2
  exit 2
}

case "$command" in
  *"git push"*--force*develop*|*"git push"*--force*main*|*"git push"*-f\ *develop*|*"git push"*-f\ *main*)
    block "force-push to develop/main" ;;
esac

echo "$command" | grep -Eq 'git\s+reset\s+--hard' && block 'git reset --hard'
echo "$command" | grep -Eq 'git\s+clean\s+-[a-zA-Z]*f' && block 'git clean -f'
echo "$command" | grep -Eq 'git\s+branch\s+-D\b' && block 'git branch -D'
echo "$command" | grep -Eq 'git\s+(checkout|restore)\s+\.' && block 'git checkout/restore .'

exit 0
