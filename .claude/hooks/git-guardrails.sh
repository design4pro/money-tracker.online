#!/usr/bin/env bash
# PreToolUse hook (Bash): blocks destructive git commands for everyone, and in agent runs
# (CEZ_TASK_ID or GITHUB_ACTIONS set) the commands ADR 0014 reserves for scripts/agent/.
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

# Everything below applies to agent runs only; a developer at the keyboard keeps gh and pnpm.
# The scripts in scripts/agent/ are the only thing that writes to GitHub, so that every label,
# comment and PR a run produces has one auditable author (ADR 0014).
[ -n "${CEZ_TASK_ID:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ] || exit 0

agent_block() {
  echo "BLOCKED (agent run): '$command' matches '$1'. Use the scripts in scripts/agent/ from the workflow allowlist instead." >&2
  exit 2
}

echo "$command" | grep -Eq 'git\s+add\s+(-A|--all|\.)(\s|$)' && agent_block 'git add -A|.'
echo "$command" | grep -Eiq '\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s*:?\s*#[0-9]+' && agent_block 'closing keyword (Closes #n)'
echo "$command" | grep -Eq 'gh\s+(issue|pr)\s+(create|edit|close|reopen|comment|delete|transfer|pin|unpin|lock|unlock|merge|review|ready|checkout)\b' && agent_block 'gh issue|pr mutation'
echo "$command" | grep -Eq 'gh\s+(label|release|repo|secret|variable|workflow|run)\s' && agent_block 'gh mutation surface'
if echo "$command" | grep -Eq '(^|[^[:alnum:]_/-])gh\s+api\b'; then
  echo "$command" | grep -Eq '(--method|-X)[[:space:]=]*(POST|PATCH|PUT|DELETE)|(^|\s)(-f|-F|--field|--raw-field|--input)(\s|=)' && agent_block 'gh api non-GET'
fi
echo "$command" | grep -Eq '(^|[^[:alnum:]_/-])(pnpm\s+(dlx|exec|run)|npx|pnpx)\b' && agent_block 'pnpm dlx|exec|run / npx'
echo "$command" | grep -Eq '(^|[^[:alnum:]_/-])printenv\b' && agent_block 'printenv'
echo "$command" | grep -Eq '(^|[^[:alnum:]_/-])env(\s*$|\s*\||\s+-0|\s*;|\s*&&)' && agent_block 'env dump'

exit 0
