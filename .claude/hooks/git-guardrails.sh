#!/usr/bin/env bash
# PreToolUse hook (Bash): blocks destructive git commands, `--no-verify` and the two Cloudflare
# operations nothing recovers from - writing a secret and deleting a D1/R2/KV store - for
# everyone; and in agent runs (CEZ_TASK_ID or GITHUB_ACTIONS set) the things an om-* run never
# needs: dumping the environment (the worktree holds live secrets in .dev.vars), changing the
# pinned stack (docs/SPEC.md §3), and shipping - deploys and remote migrations. GitHub mutations,
# `git add -A`, closing keywords and `pnpm exec` are the om-* skills' ordinary tools (tracker
# descriptor .ai/trackers/github.md, SDLC.md) and stay open (ADR 0017).
#
# The Cloudflare rules are split by what a mistake costs. A deploy is undone by deploying again,
# so a developer at the keyboard keeps the ordinary approval prompt for it; a written secret is
# already in the transcript and a deleted database is gone, so those are refused in every
# session. These lived in `.claude/settings.json` as `permissions.deny` until the deny rules moved
# out of it; the hook is what carries them now, and nothing that refuses a command belongs back in
# that file - its allow list is only for the tracker operations the om-* pipeline cannot run
# without.
#
# Everything in the first block destroys work that is not recoverable from the reflog by someone
# who does not already know to look. `develop` and `main` are the shared branches - staging and
# production respectively - so a force-push to either is a rewrite of what somebody else has
# already pulled.
#
# Contract: exit 2 blocks the tool call and feeds stderr back to the model; exit 0 allows.
set -euo pipefail

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

[ -z "$command" ] && exit 0

# A rule matches the command, not prose about it. Quoted text and the body of a quoted-delimiter
# heredoc are data - `grep -rn "wrangler secret" docs/` searches DEPLOY.md, and a commit message
# about a deploy script deploys nothing - so both are stripped before matching. A string handed
# to a shell with `-c`, or to `eval`/`xargs`, is executed, so those keep the whole command.
scan="$command"
case "$command" in
  *' -c '*| *'eval '* | *xargs*) ;;
  *)
    scan=$(printf '%s' "$command" | awk '
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
    ;;
esac

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
# tree reaches a pull request. AGENTS.md promises this under `## Never`.
echo "$scan" | grep -Eq 'git\s+.*--no-verify' && block 'git --no-verify'
echo "$scan" | grep -Eq 'git\s+commit\b.*\s-n(\s|$)' && block 'git --no-verify'

# A secret named on a command line is already in the transcript, and a deleted D1 database, R2
# bucket, KV namespace or Worker does not come back - deleting the Worker takes its routes, its
# Durable Object binding and the live deployment with it. Neither has a legitimate caller here,
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
# `pnpm -s run deploy` and `pnpm --filter web deploy` are the same deploy, so flags and a filter
# argument are skipped over rather than treated as the end of the command.
echo "$scan" | grep -Eq '(^|[^[:alnum:]_/-])pnpm\s+((-{1,2}[^[:space:]]+|[a-z]+)\s+)*(deploy:staging|db:migrate:prod|db:migrate:staging|deploy)(\s|$)' \
  && agent_block 'pnpm deploy|remote migration' 'Deploys and remote migrations are a human decision; end the run as blocked.'

exit 0
