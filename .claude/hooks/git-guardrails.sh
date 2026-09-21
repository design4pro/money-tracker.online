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
#
# A backslash-newline is a line continuation: the shell joins the two lines into one command. Every
# rule below is line-based - `grep` reads a line at a time, and the push loop splits on newlines -
# so a continued command arrived as two fragments, each missing what the other held, and no rule
# saw a command it recognised. `unquote()` removes the backslash and leaves the newline, which is
# what made the halves look like two separate commands.
#
# It is not only the push rule the review found it in. `rm -rf \` + newline + `/`, and `cat \` +
# newline + `.dev.vars`, were allowed by the same mechanism: three of this file's rules defeated by
# a line break a person would write for readability.
#
# awk rather than sed, because matching an embedded newline in the pattern space is a GNU extension
# and BSD sed - the one macOS ships - rejects it. A line that does not end in a backslash keeps its
# newline, so a real newline still separates two commands, which is what the prose test below and
# the push loop rely on.
joined=$(printf '%s' "$command" | awk '{ if (sub(/\\$/, " ")) printf "%s", $0; else print }')
raw=$(unquote "$joined")

if [ -n "${GITHUB_ACTIONS:-}" ]; then
  scan="$raw"
else
  scan="$raw"
  # Here-strings, not pipes: `grep -q` closes early, and under `pipefail` that turns a match into
  # a non-zero pipeline - the one failure shape that would silently re-open the stripping.
  if grep -Eq "$prose_command" <<< "${joined%%$'\n'*}"; then
    text=$(printf '%s' "$joined" | awk '
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

# The flag and the ref come in either order, and the pattern this replaces wanted the flag first:
# `git push origin develop --force` read straight past it while looking as though it was covered.
# `--force-with-lease` is deliberately inside the flag pattern: leased or not, it rewrites what
# somebody else has already pulled, and only the branch decides.
#
# The line is cut into simple commands first, and both halves have to match the *same* piece. Two
# independent searches over the whole string were wrong in both directions at once, and the second
# way was the worse one:
#
#   - over-blocking, which is what the comment here used to deny while the code did it anyway:
#     a forced push to a feature branch followed by an ordinary push of develop was read as one
#     forced push of develop and refused.
#   - under-blocking, which no review caught and the split closes as a by-product: `develop` had to
#     be followed by a space, a colon or the end of the line, and a `;` is none of those, so
#     `git push --force origin develop; echo done` matched neither half's right-hand boundary and
#     went through. Inside a piece, that `develop` sits at the end of the line.
#
# Short flags bundle, and git's own syntax is what a person types: `-fu` and `-uf` both carry `-f`
# and neither matched a pattern that wanted `-f` standing alone. `f` anywhere in a single-dash run
# of letters is the force flag - no other short flag of `git push` is spelled `f` - while `--force`
# stays its own alternative, because `--` is not a letter and must not be read as a bundle.
#
# A branch does not have to be named to be reached. `--all` pushes every local branch and `--mirror`
# every ref, so both arrive at develop and main without spelling either. `--mirror` is in *both*
# patterns rather than only the second: it deletes remote refs the local side lacks and forces the
# rest, so it is a forced push to the shared branches on its own, with or without `--force`. That
# is wider than the thread that prompted this, which named only `--force --all`; it is the same
# hole and refusing half of it would have been a worse answer than saying so here.
push_force='git[[:space:]]+push\b[^;&|]*[[:space:]](--force|--mirror([[:space:]]|$)|-[[:alnum:]]*f[[:alnum:]]*([[:space:]]|$))'
push_shared='git[[:space:]]+push\b[^;&|]*(([[:space:]]|[/+:])(develop|main)([[:space:]]|:|$)|[[:space:]](--all|--mirror)([[:space:]]|$))'
while IFS= read -r push_command; do
  grep -Eq "$push_force" <<< "$push_command" || continue
  grep -Eq "$push_shared" <<< "$push_command" || continue
  block 'force-push to develop/main'
done <<< "$(tr ';&|' '\n' <<< "$scan")"

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
#
# `rm` takes more than one operand, and a harmless one in front is not a reprieve for the rest:
# `rm -rf dist .git` destroys .git exactly as `rm -rf .git` does, and the first shape of this rule
# allowed it because only flags were permitted between the recursive flag and the target. So what
# the target may hide behind is any operand, not just a flag - stopping at a control operator,
# because past one the `rm` has ended. The target itself still has to match whole, which is what
# keeps `rm -rf dist` and `rm -rf /tmp/x` open.
#
# `rm` also answers to its path. The left boundary is a negated class that excludes `/`, so the `/`
# in `/bin/rm` failed it and the whole rule quietly did not match - a fail-open on the single
# command it exists for. The optional directory prefix is the same allowance `secret_head` already
# makes for readers two sections down. It has to end in `/` to be consumed, so `charm -rf /` still
# fails the boundary and `git rm -r .` still matches on the space, exactly as before.
rm_flags='(-[[:alnum:]-]+[[:space:]]+)*'
rm_operands='([^[:space:];&|]+[[:space:]]+)*'
rm_path='([^[:space:];&|]*/)?'
rm_recursive="(^|[^[:alnum:]_/-])${rm_path}rm[[:space:]]+${rm_flags}-[[:alnum:]-]*[rR][[:alnum:]-]*[[:space:]]+${rm_operands}"
rm_end='([[:space:]]|;|&|\||\)|$)'

# `./.git` deletes what `.git` deletes, and `./` is how a path is ordinarily written rather than an
# evasion. The alternation had only a trailing `/?\*?`, so the leading spelling slid past it:
# `.` matched and then `rm_end` met `/.git` instead of a boundary. `..` in front works the same way,
# which is what `rm -rf ../..` was. The prefix is optional and repeatable and changes nothing else -
# `./node_modules` still has no dangerous root behind it and stays open.
rm_dots='(\.\.?/)*'

# `git rm -r --cached .` is an index operation: it unstages, touches no file on disk, and `git
# reset` puts it back. It reached this rule because `rm` is matched as a word and a space is a word
# boundary, so `git rm` read as `rm`. The exemption is keyed on `--cached` and not on the word
# `git`, because `git rm -r .` without it deletes the working tree and is exactly what the rule is
# for. Only that one command is cut out of what the two rules below read, so
# `git rm -r --cached . && rm -rf /` is still refused on its second half.
rm_scan=$(printf '%s' "$scan" | sed -E 's/git[[:space:]]+rm[^;&|]*--cached[^;&|]*//g')

echo "$rm_scan" | grep -Eq "${rm_recursive}${rm_dots}(/|~|\\\$\{?HOME\}?|\.|\.\.|\*|\.git)/?\*?${rm_end}" \
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
#
# `project_root` is the path already expanded, and the command is not: the two variables named
# above are how this root is usually written, and `$(pwd)` is a third spelling of the same
# directory. A rule that knew only the expansion refused `rm -rf /Users/.../money-tracker.online`
# and allowed `rm -rf $PWD`, which deletes the same tree. `$HOME` is in the alternation above for
# exactly this reason; these belong here for the same one.
project_root=$(printf '%s' "${CLAUDE_PROJECT_DIR:-$PWD}" | sed 's/[].*^$()+?{}|[\\]/\\&/g')
project_root_spelling='\$\{?(PWD|CLAUDE_PROJECT_DIR)\}?|\$\(pwd\)|`pwd`'
echo "$rm_scan" | grep -Eq "${rm_recursive}(${project_root}|${project_root_spelling})/?\*?${rm_end}" \
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
#
# The `+` rule is anchored on the prefix, not on the colon: `git push origin +develop` is git's own
# shorthand for `+develop:develop` and forces the update just as loudly, so requiring the colon
# read the shorthand as an ordinary push. Nothing legitimate starts a push argument with `+`.
echo "$scan" | grep -Eq 'git\s+push\b[^;&|]*(--delete|[[:space:]]-d)([[:space:]]|$)' \
  && block 'git push --delete'
echo "$scan" | grep -Eq 'git\s+push\b[^;&|]*[[:space:]]:[^[:space:]]+' \
  && block 'git push :branch (deletes the remote branch)'
echo "$scan" | grep -Eq 'git\s+push\b[^;&|]*[[:space:]]\+[^[:space:]]' \
  && block 'git push +refspec (forced)'

# History rewriting. The reflog is what makes a hard reset recoverable by someone who knows to look,
# so expiring it removes the recovery every rule above quietly assumes; filter-branch and
# filter-repo rewrite every commit in place.
echo "$scan" | grep -Eq 'git\s+(filter-branch|filter-repo)\b' && block 'git filter-branch/filter-repo'
echo "$scan" | grep -Eq 'git\s+reflog\s+(expire|delete)\b' && block 'git reflog expire'
echo "$scan" | grep -Eq 'git\s+gc\b[^;&|]*--prune=(now|all)' && block 'git gc --prune=now'

# The hole guard-read.sh names in its own header: it guards Read, Glob and Grep, and `cat .dev.vars`
# is a Bash call that never reaches it.
#
# The rule is decided one simple command at a time. Its first shape ran two independent searches
# over the whole string - "a reader word appears somewhere" and "a secret filename appears
# somewhere" - which is the same over-broad mistake this file's header already records once: it
# refused a commit message that merely named the read, and a `grep` looking for the string
# `.dev.vars` in this very directory, while a reader reached through a path was not a reader at
# all. So the command is cut at its control operators and each piece is judged by its head word,
# which is what separates an invocation from a mention: `cat .dev.vars` has `cat` as its head word
# and a commit message naming it does not. `$(`, `)` and a backtick cut too, so the inner command
# of `echo $(cat .dev.vars)` is judged on its own rather than on the `echo`.
#
# Readers only - a command that opens the file and prints it. `cp` and `mv` are absent because
# `cp .dev.vars.example .dev.vars` is how the file is created, and a rule that could not tell those
# two apart would refuse the setup step it is meant to protect. The head word is read through an
# optional directory prefix, because `/bin/cat` is `cat`.
#
# A pattern-taking reader spends its first operand on the pattern and not on a path, so that
# operand is dropped before the filename is looked for. That is the difference between
# `grep .dev.vars .claude/hooks`, which searches for the string, and `grep APP_URL .dev.vars`,
# which reads the file.
#
# It reads $raw, not $scan. `cat` is on the prose list, so for `cat ".dev.vars"` the quoted span is
# deleted before $scan is built and the rule would see `cat` alone - quoting the path would be the
# whole bypass. $raw has only the quote characters removed, and the head-word test is what the
# prose stripping was doing here, done in a way a reader cannot step around.
#
# A redirection is a read, and the shell does not need a space for one: `cat<.dev.vars` is
# `cat < .dev.vars`. So `<` and `>` are spaced out before anything is tokenised, which closes that
# spelling and one other - `cat .dev.vars>/tmp/out.example` was a single token ending `.example`,
# and the template exemption below deleted the secret along with it.
#
# A path ending `.example`, `.sample` or `.template` is dropped first, per token rather than by
# testing the whole command for the word, so `cat .dev.vars .dev.vars.example` is still refused on
# its first argument. Those three suffixes are also why the filename needs a right-hand boundary:
# without one, `\.env` matched `.envrc`, which is direnv's config and not a secret, while
# `.env.local` and `.env.production` still have to be refused.
#
# A glob is a filename this hook cannot read, because the shell expands it after the hook has
# spoken: `cat .dev.var?` and `cat .dev.*` both print the real file. What can be decided here is
# the literal part in front of the first metacharacter - if a secret name starts with it, the glob
# can reach the secret. A metacharacter in the first position of the name leaves nothing to decide,
# so `cat *` and `cat .ai/qa/*` are not refused; that is the same limit the rest of this rule has.
#
# Here-strings, not pipes, for the same reason the prose test above uses them: `grep -q` closes
# early, and under `pipefail` that turns a match into a non-zero pipeline - so on a long command
# the `if` read false and the rule failed open, which is the one direction it must never fail.
#
# .ai/scripts/test-env-up.sh reads .dev.vars by design and keeps working: it is invoked as one
# command, so this hook sees `sh .ai/scripts/test-env-up.sh` and the `head` and `grep` inside it are
# the script's own business. That is the shape of the guarantee here - an obvious read is refused, a
# determined one is not. The deny list in .claude/settings.json is the layer that does not depend on
# enumerating readers.
secret_file='(^|[[:space:]]|=|/)(\.dev\.vars|\.env|test-env\.env)([[:space:]]|$|\.|/)'
secret_names='.dev.vars .env test-env.env'
secret_head='^[[:space:]]*(([!{]|if|then|else|elif|do|while|until|time)[[:space:]]+)*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*([^[:space:]]*/)?'
plain_reader='cat|bat|less|more|head|tail|strings|xxd|od|base64|nl|tac|cut|sort|uniq|dd'
pattern_reader='grep|egrep|fgrep|rg|ag|awk|sed'

# Everything after the head word, minus - for a pattern-taking reader, which is what $2 says - the
# first operand that is not a flag. That one is the pattern.
reader_operands() {
  local out='' skipped="$2" i
  local -a words
  read -r -a words <<< "$1"
  for ((i = 1; i < ${#words[@]}; i++)); do
    if [ "$skipped" = 0 ] && [ "${words[i]#-}" = "${words[i]}" ]; then
      skipped=1
      continue
    fi
    out="$out ${words[i]}"
  done
  printf '%s' "$out"
}

# A glob reaches whatever it expands to, and that happens after this hook has answered. Refuse the
# ones whose literal head is a head of a secret name; a glob that starts with the metacharacter
# says nothing and is left alone.
# The loop is indexed rather than `for arg in "${words[@]}"`, which under `set -u` is an unbound
# variable on an empty array in bash 3.2 - the shell macOS ships, and the one that ended this hook
# with exit 1 on `env | grep TOKEN` until the case table was run against it.
glob_reaches_secret() {
  local arg literal name i
  local -a words
  read -r -a words <<< "$1"
  for ((i = 0; i < ${#words[@]}; i++)); do
    arg=${words[i]}
    case "$arg" in
      *[*?[]*) ;;
      *) continue ;;
    esac
    literal=${arg%%[*?[]*}
    literal=${literal##*/}
    [ -z "$literal" ] && continue
    for name in $secret_names; do
      case "$name" in
        "$literal"*) return 0 ;;
      esac
    done
  done
  return 1
}

# An empty quoted pattern is an argument, not an absence: `grep "" .dev.vars` matches every line
# and `sed '' .dev.vars` is `cat`. unquote() removes quote *characters*, so the pair collapsed to
# nothing, the argument vanished from the token stream, and the filename slid into the slot
# `reader_operands` drops as "the pattern" - the secret was never looked at. A sentinel holds the
# slot. It must not begin with `-`, or `reader_operands` reads it as a flag and drops the filename
# again instead.
secret_raw=$(printf '%s' "$joined" | sed -e 's/""/EMPTY_PATTERN/g' -e "s/''/EMPTY_PATTERN/g")
secret_raw=$(unquote "$secret_raw")

# `< .dev.vars cat` is valid and ordinary, and spacing the operator out is not enough on its own:
# it leaves the filename in front of the reader, where `secret_head` - anchored at `^` - reads the
# filename as the head word, finds no reader and moves on. So a leading redirection is rotated to
# the back of its own piece first, which turns it into the `cat < .dev.vars` spelling the next
# expression already handles.
secret_commands=$(tr ';&|()`' '\n' <<< "$secret_raw" \
  | sed -E -e 's/^[[:space:]]*<[[:space:]]*([^[:space:]]+)[[:space:]]+(.*)$/\2 \1/' -e 's/[<>]/ /g')
while IFS= read -r secret_command; do
  if grep -Eq "${secret_head}(${plain_reader})([[:space:]]|$)" <<< "$secret_command"; then
    secret_args=$(reader_operands "$secret_command" 1)
  elif grep -Eq "${secret_head}(${pattern_reader})([[:space:]]|$)" <<< "$secret_command"; then
    secret_args=$(reader_operands "$secret_command" 0)
  else
    continue
  fi
  secret_args=$(sed -E 's/[^[:space:]]*\.(example|sample|template)([[:space:]]|$)/ /g' <<< "$secret_args")
  grep -Eq "$secret_file" <<< "$secret_args" \
    && block 'reading .dev.vars, .env or the QA test-env file'
  glob_reaches_secret "$secret_args" \
    && block 'reading .dev.vars, .env or the QA test-env file'
done <<< "$secret_commands"

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
