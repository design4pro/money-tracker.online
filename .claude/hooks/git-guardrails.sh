#!/usr/bin/env bash
# PreToolUse hook (Bash). Three tiers, by who is at the other end of the command.
#
# Tier one - everyone, in every session: destructive git, `--no-verify`, and the two Cloudflare
# operations nothing recovers from - writing a secret and deleting a D1/R2/KV store or the Worker
# itself. Everything here destroys work that is not recoverable from the reflog by someone who
# does not already know to look. `develop` and `main` are the shared branches - staging and
# production respectively - so a force-push to either rewrites what somebody else has pulled.
#
# Tier two - agent runs (CEZ_TASK_ID or GITHUB_ACTIONS): the things an om-* run never needs.
# Dumping the environment (the worktree holds live secrets in .dev.vars), changing the pinned
# stack (docs/SPEC.md §3), and shipping - deploys and remote migrations. GitHub mutations,
# `git add -A`, closing keywords and `pnpm exec` are the om-* skills' ordinary tools (tracker
# descriptor .ai/trackers/github.md, SDLC.md) and stay open under Cezar.
#
# Tier three - GitHub Actions only: the whole `gh` mutation surface. See the section itself.
#
# The Cloudflare rules are split by what a mistake costs. A deploy is undone by deploying again,
# so a developer at the keyboard keeps the ordinary approval prompt for it; a written secret is
# already in the transcript and a deleted database is gone, so those are refused in every session.
# Nothing that refuses a command belongs in `.claude/settings.json` - its allow list is only for
# the tracker operations the om-* pipeline cannot run without.
#
# Contract: exit 2 blocks the tool call and feeds stderr back to the model; exit 0 allows.
set -euo pipefail

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

[ -z "$command" ] && exit 0

# A rule matches the command, not prose about it - and deciding which is which is the whole
# problem. The first shape of this got it backwards: it listed the ways a string gets *executed*
# and read everything else as text. A denylist of ways to run a string is a list that is always
# missing one, and it was missing four - `bash -lc`, `sh -ec`, `node -e` and a heredoc redirected
# into a shell all had their payload deleted before a rule saw it. It was over-broad in the same
# stroke, on raw substrings: `grep -c` was refused, and so was a commit message that merely
# contained the token - including the one writing this fix.
#
# So the list is inverted. Quoted spans and heredoc bodies are discarded only for a closed set of
# commands whose quoted arguments are text *by definition*, and only when nothing else hides
# behind them. Everything else - every executor, listed or not - keeps every word. An unknown
# command now fails closed, which is the direction this file's mistakes should point.
#
# Backslash is a quoting character too, and both audiences need it gone: the shell drops it and
# keeps the character, so `gh pr \review 12 --approve` invokes `gh pr review` while a `tr` that
# deletes only the two quote marks left it matching nothing.
unquote() { printf '%s' "$1" | tr -d '"\047\\'; }

# Nothing on this list can execute a string it is handed: a message, a pattern, a heredoc written
# to a file. `sed` (GNU `s///e`) and `awk` (`system()`) can, so they are deliberately absent even
# though their arguments read as prose - the criterion is what the command *can* do, not what it
# usually does.
prose_command='^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(git[[:space:]]+(commit|tag|stash|notes)|gh[[:space:]]+(pr|issue|release)[[:space:]]+[a-z-]+|grep|egrep|fgrep|rg|echo|printf|cat|tee)([[:space:]]|$)'

# Under GitHub Actions nothing is discarded at all, not even for those commands: there the string
# comes from an attacker-authored diff, so a commit message is untrusted input like the rest of
# it. Only the quoting characters go, which is what makes `gh pr "review" 12 --approve` still
# match the rule for `gh pr review` - the raw string does not, because the quotes sit exactly
# where the verb is expected.
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  scan=$(unquote "$command")
else
  scan=$(unquote "$command")
  # Here-strings, not pipes: `grep -q` closes early, and under `pipefail` that turns a match into
  # a non-zero pipeline - the one failure shape that would silently re-open the stripping.
  if grep -Eq "$prose_command" <<< "${command%%$'\n'*}"; then
    text=$(printf '%s' "$command" | awk '
      skip { if ($0 == tag) skip = 0; next }
      {
        if (match($0, /<<-?["\047][A-Za-z_][A-Za-z0-9_]*["\047]/)) {
          tag = substr($0, RSTART, RLENGTH)
          gsub(/^<<-?["\047]|["\047]$/, "", tag)
          skip = 1
        }
        print
      }
    ' | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")
    # A control operator means a second command hides behind the first, and the head word says
    # nothing about it: a `grep` chained by `&&` into a shell invocation would have had the
    # payload stripped as if it were the grep's own pattern. Only a lone simple command is text.
    grep -Eq '[|;&`]|\$\(' <<< "$text" || scan="$text"
  fi
fi

block() {
  echo "BLOCKED: '$command' matches dangerous pattern '$1'. The user has prevented you from doing this." >&2
  exit 2
}

case "$scan" in
  *"git push"*--force*develop*|*"git push"*--force*main*|*"git push"*-f\ *develop*|*"git push"*-f\ *main*)
    block "force-push to develop/main" ;;
esac

echo "$scan" | grep -Eq 'git\s+reset\s+--hard' && block 'git reset --hard'
echo "$scan" | grep -Eq 'git\s+clean\s+-[a-zA-Z]*f' && block 'git clean -f'
echo "$scan" | grep -Eq 'git\s+branch\s+-D\b' && block 'git branch -D'
echo "$scan" | grep -Eq 'git\s+(checkout|restore)\s+\.' && block 'git checkout/restore .'
# The pre-commit hook is the fast gate (lint-staged, typecheck, tests); skipping it is how a red
# tree reaches a pull request.
echo "$scan" | grep -Eq 'git\s+.*--no-verify' && block 'git --no-verify'
echo "$scan" | grep -Eq 'git\s+commit\b.*\s-n(\s|$)' && block 'git --no-verify'

# A secret named on a command line is already in the transcript, and a deleted D1 database, R2
# bucket, KV namespace or Worker does not come back - deleting the Worker takes its routes, its
# Durable Object bindings and the live deployment with it. Neither has a legitimate caller here,
# in any session.
echo "$scan" | grep -Eq 'wrangler\s+secret\b' && block 'wrangler secret'
echo "$scan" | grep -Eq 'wrangler\s+((d1|r2\s+bucket|kv\s+namespace)\s+)?delete\b' && block 'wrangler delete'

# Everything below applies to agent runs only; a developer at the keyboard keeps pnpm and env.
[ -n "${CEZ_TASK_ID:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ] || exit 0

agent_block() {
  echo "BLOCKED (agent run): '$command' matches '$1'. $2" >&2
  exit 2
}

echo "$scan" | grep -Eq '(^|[^[:alnum:]_/-])pnpm\s+(add|remove|rm|uninstall|update|up|upgrade)\b' \
  && agent_block 'pnpm add|remove|update' 'The stack is pinned (docs/SPEC.md §3); end the run as blocked and name the dependency.'
echo "$scan" | grep -Eq '(^|[^[:alnum:]_/-])printenv\b' && agent_block 'printenv' 'The environment holds secrets.'
echo "$scan" | grep -Eq '(^|[^[:alnum:]_/-])env(\s*$|\s*\||\s+-0|\s*;|\s*&&)' && agent_block 'env dump' 'The environment holds secrets.'

# Shipping is a human decision, and an unattended run has nobody to answer a prompt about it.
# `deploy` is not the only way to ship: `versions upload` + `versions deploy` is the gradual
# rollout, `rollback` and `triggers deploy` change what production serves, and `d1 execute
# --remote` reaches the live database. `db:migrate:local` is the local D1 copy and stays open;
# `--remote` is what names staging or production.
echo "$scan" | grep -Eq 'wrangler\s+(deploy|rollback|versions\s+(deploy|upload)|triggers\s+deploy)\b' \
  && agent_block 'wrangler deploy' 'Deploying is a human decision; end the run as blocked and say what is ready to ship.'
echo "$scan" | grep -Eq 'wrangler\s+d1\s+(migrations\s+apply|execute)\b.*--remote' \
  && agent_block 'remote d1 access' 'The staging and production databases are a human decision; end the run as blocked.'
# The package scripts that reach staging or production, named as this repository spells them -
# `db:migrate:staging` and `db:migrate:prod`, not the `db:migrate:remote` of a sibling repo. A
# list copied from elsewhere would match nothing here and look protective while being inert.
# Longest alternative first, and flags and a filter argument are skipped over, so
# `pnpm -s run deploy` and `pnpm --filter web deploy` are the same deploy.
echo "$scan" | grep -Eq '(^|[^[:alnum:]_/-])pnpm\s+((-{1,2}[^[:space:]]+|[a-z]+)\s+)*(deploy:staging|db:migrate:staging|db:migrate:prod|deploy)(\s|$)' \
  && agent_block 'pnpm deploy|remote migration' 'Deploys and remote migrations are a human decision; end the run as blocked.'

# GitHub Actions only. .github/workflows/claude-code-review.yml runs on every pull_request
# with `--permission-mode bypassPermissions` and a pull-requests:write token, so the diff it
# reads is untrusted input and this hook is the only thing between a crafted PR and
# `gh pr review --approve`. A Cezar run (CEZ_TASK_ID) is different: it runs on the
# operator's host, on work the operator queued, and mutates GitHub through the tracker
# descriptor by design, so these blocks do not apply there.
[ -n "${GITHUB_ACTIONS:-}" ] || exit 0

actions_block() {
  echo "BLOCKED (GitHub Actions): '$command' matches '$1'. The review job posts one comment and nothing else." >&2
  exit 2
}

echo "$scan" | grep -Eq 'gh\s+(issue|pr)\s+(create|edit|close|reopen|delete|transfer|pin|unpin|lock|unlock|merge|review|ready|checkout)\b' && actions_block 'gh issue|pr mutation'
# `comment` is the one verb with an exception. The code review posts its summary with
# `gh pr comment`, and that job is the one agent run whose whole purpose is to write to a pull
# request. Only .github/workflows/claude-code-review.yml sets the variable, and a pull request
# cannot set it for itself: editing that workflow makes the action's OIDC exchange refuse to run
# the review at all. `gh issue comment` stays blocked either way.
comment_targets='issue|pr'
[ "${CLAUDE_REVIEW_PR_COMMENT:-}" = 1 ] && comment_targets='issue'
echo "$scan" | grep -Eq "gh\s+($comment_targets)\s+comment\b" && actions_block 'gh issue|pr mutation'
echo "$scan" | grep -Eq 'gh\s+(label|release|repo|secret|variable|workflow|run)\s' && actions_block 'gh mutation surface'
if echo "$scan" | grep -Eq '(^|[^[:alnum:]_/-])gh\s+api\b'; then
  echo "$scan" | grep -Eq '(--method|-X)[[:space:]=]*(POST|PATCH|PUT|DELETE)|(^|\s)(-f|-F|--field|--raw-field|--input)(\s|=)' && actions_block 'gh api non-GET'
fi

exit 0
