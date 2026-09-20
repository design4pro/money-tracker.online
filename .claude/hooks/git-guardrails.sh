#!/usr/bin/env bash
# PreToolUse hook (Bash). Three tiers, by who is at the other end of the command.
#
# Tier one - everyone, in every session: destructive git, `--no-verify`, the two Cloudflare
# operations nothing recovers from - writing a secret and deleting a D1/R2/KV store or the Worker
# itself - and, further down, the four that do not go through git at all: `rm -r` at a dangerous
# root, `gh repo delete` and its siblings, a push that deletes or forces a refspec, and history
# rewriting. Everything here destroys work that is not recoverable from the reflog by someone who
# does not already know to look. `develop` and `main` are the shared branches - staging and
# production respectively - so a force-push to either rewrites what somebody else has pulled.
# Tier one closes with the one read that is not a write: the secret files, which guard-read.sh
# cannot reach because `cat .dev.vars` arrives here as a Bash call instead.
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
# Almost nothing that refuses a command belongs in `.claude/settings.json`. The reasoning lives
# here, where it can be written down and tested; the deny list there carries only the handful of
# rules that must survive this file being edited, broken or never invoked, and it is deliberately
# too short to reason with. The two layers are not redundant: a hook can fail, and `deny` cannot
# explain itself.
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
# $raw is the command with only its quoting characters gone - no prose stripping, ever. Most rules
# read $scan, because a commit message that merely names a dangerous command is not that command.
# The secret-file rule reads $raw instead: `cat` is on the prose list above, so for `cat ".dev.vars"`
# the quoted span would be deleted before $scan is built and quoting the path would be the bypass.
raw=$(unquote "$command")

if [ -n "${GITHUB_ACTIONS:-}" ]; then
  scan="$raw"
else
  scan="$raw"
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
    #
    # A newline is one of those operators. It separates commands exactly as `;` does, and leaving
    # it out of the set was the whole bug: the head-word test above reads only the first line, so
    # a prose head word followed by a newline and an executor carrying a quoted payload passed as
    # prose, and the payload was deleted before a rule saw it. The awk above has already removed
    # heredoc bodies, so a newline still in $text is a second command, never a quoted document -
    # which is why the heredoc commit-message shape keeps its exemption.
    #
    # The trade-off, taken deliberately: a multi-line command that both starts with a prose head
    # word and carries a matching token inside quotes on a later line is now refused. Re-issue it
    # as one line. That is the fail-closed direction this file's mistakes should point in.
    if ! grep -Eq '[|;&`]|\$\(' <<< "$text" && [ "$text" = "${text%%$'\n'*}" ]; then
       scan="$text"
    fi
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

# The rules above all take git as their subject, and a repository is not the only thing a run can
# destroy. These four do not go through git at all, or go through it sideways: `rm -r` at a
# dangerous root, deleting the repository on GitHub, pushing a deletion or a forced refspec, and
# rewriting history. None is recoverable from this checkout and none has a caller in any session.

# `rm -r` is dangerous only where it points, so the target has to match whole: `rm -rf dist`,
# `rm -rf node_modules` and `rm -rf /tmp/x` stay open while `rm -rf .`, `rm -rf /`, `rm -rf ~`,
# `rm -rf *` and `rm -rf .git` do not. The flag group repeats on both sides of the recursive flag,
# which is what makes `rm --recursive --force /` and `rm -r -f /` read the same as `rm -rf /`.
rm_flags='(-[[:alnum:]-]+[[:space:]]+)*'
rm_recursive="(^|[^[:alnum:]_/-])rm[[:space:]]+${rm_flags}-[[:alnum:]-]*[rR][[:alnum:]-]*[[:space:]]+${rm_flags}"
rm_end='([[:space:]]|;|&|\||\)|$)'
echo "$scan" | grep -Eq "${rm_recursive}(/|~|\\\$\{?HOME\}?|\.|\.\.|\*|\.git)/?\*?${rm_end}" \
  && block 'rm -r of a dangerous root'

# The worktree root spelled out, which the pattern above cannot cover because it is a path like any
# other. CLAUDE_PROJECT_DIR is what the harness sets; $PWD is the fallback, and under cezar that is
# the worktree the task was given rather than the developer's checkout. Only the root itself, so
# `rm -rf $root/node_modules` - how a bootstrap step recovers from a half-written install - stays
# open.
# `[` comes last in the set on purpose: `[.`, `[=` and `[:` open a collating symbol, an equivalence
# class and a character class, so a `[` sitting before the `.` makes BSD sed reject the whole
# expression - and under `set -e` that ends the hook with exit 1, which the harness reads as
# "allowed". A guard that fails open is worse than no guard, and this one did until it was run.
project_root=$(printf '%s' "${CLAUDE_PROJECT_DIR:-$PWD}" | sed 's/[].*^$()+?{}|[\\]/\\&/g')
echo "$scan" | grep -Eq "${rm_recursive}${project_root}/?\*?${rm_end}" \
  && block 'rm -r of the project root'

# The repository itself. Tier three refuses the whole `gh repo` surface under Actions; these four
# verbs are refused in every session, because none of them is undone by running something again: a
# rename breaks the remote of every open worktree, a transfer moves the repository out of reach,
# archiving makes it read-only, and a delete ends it.
echo "$scan" | grep -Eq 'gh\s+repo\s+(delete|archive|rename|transfer)\b' \
  && block 'gh repo delete/archive/rename/transfer'

# Refspecs. AGENTS.md requires `git push origin HEAD:refs/heads/<branch>` precisely because a bare
# branch name lets push.default choose the destination, so the colon is this repository's ordinary
# spelling and stays open. What is refused is the colon with an empty source - `git push origin
# :develop` deletes the remote branch - the explicit `--delete`, and a `+` prefix, which forces the
# update whatever the remote holds and is a force-push wearing a refspec.
echo "$scan" | grep -Eq 'git\s+push\b[^;&|]*(--delete|[[:space:]]-d)([[:space:]]|$)' \
  && block 'git push --delete'
echo "$scan" | grep -Eq 'git\s+push\b[^;&|]*[[:space:]]:[^[:space:]]+' \
  && block 'git push :branch (deletes the remote branch)'
echo "$scan" | grep -Eq 'git\s+push\b[^;&|]*[[:space:]]\+[^[:space:]]*:' \
  && block 'git push +refspec (forced)'

# History rewriting. The reflog is what makes a hard reset recoverable by someone who knows to look,
# so expiring it removes the recovery every rule above quietly assumes; filter-branch and
# filter-repo rewrite every commit in place.
echo "$scan" | grep -Eq 'git\s+(filter-branch|filter-repo)\b' && block 'git filter-branch/filter-repo'
echo "$scan" | grep -Eq 'git\s+reflog\s+(expire|delete)\b' && block 'git reflog expire'
echo "$scan" | grep -Eq 'git\s+gc\b[^;&|]*--prune=(now|all)' && block 'git gc --prune=now'

# The hole guard-read.sh names in its own header: it guards Read, Glob and Grep, and `cat .dev.vars`
# is a Bash call that never reaches it. Three deliberate limits.
#
# Readers only - a command that opens the file and prints it. `cp` and `mv` are absent because
# `cp .dev.vars.example .dev.vars` is how the file is created, and a rule that could not tell those
# two apart would refuse the setup step it is meant to protect.
#
# It reads $raw, not $scan. `cat` is on the prose list, so for `cat ".dev.vars"` the quoted span is
# deleted before $scan is built and the rule would see `cat` alone - quoting the path would be the
# whole bypass. $raw has only the quote characters removed.
#
# A path ending `.example` is dropped first, per token rather than by testing the whole command for
# the word, so `cat .dev.vars .dev.vars.example` is still refused on its first argument.
#
# .ai/scripts/test-env-up.sh reads .dev.vars by design and keeps working: it is invoked as one
# command, so this hook sees `sh .ai/scripts/test-env-up.sh` and the `head` and `grep` inside it are
# the script's own business. That is the shape of the guarantee here - an obvious read is refused, a
# determined one is not. The deny list in .claude/settings.json is the layer that does not depend on
# enumerating readers.
secret_reader='(^|[^[:alnum:]_/-])(cat|bat|less|more|head|tail|grep|egrep|fgrep|rg|ag|strings|xxd|od|base64|nl|tac|awk|sed|cut|sort|uniq|dd)([[:space:]]|$)'
secret_file='(^|[[:space:]]|=|/)(\.dev\.vars|\.env|test-env\.env)'
if echo "$raw" | grep -Eq "$secret_reader" \
  && printf '%s' "$raw" | sed -E 's/[^[:space:]]*\.example([[:space:]]|$)/ /g' | grep -Eq "$secret_file"; then
  block 'reading .dev.vars, .env or the QA test-env file'
fi

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
