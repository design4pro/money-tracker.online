# 0025. Permission rules replace the guard hooks

Status: accepted
Date: 2026-09-24
Amends: ADR 0017 (the hooks are no longer the gate for a step with no `bashAllowlist`), ADR 0021
(`guard-generated.sh` goes entirely, not just its agent-layer tier).

## Context

ADR 0017 made three `PreToolUse` hooks the boundary of an agent run: `git-guardrails.sh` (Bash),
`guard-read.sh` (Read, Glob, Grep) and `guard-generated.sh` (Edit, Write). With their test suite
they grew to about 900 lines of shell and 1,400 lines of tests, touched by 56 commits in four
weeks, almost all of them a newly found way to spell a refused command - a line continuation, a
heredoc, a command substitution, a symlink, a home-relative path - and the test that closed it.
`planned.travel` carries a copy, so every fix was paid twice, and the suite once reinitialised the
real repository as bare from a worktree (#429). The hooks' own headers name the problem:
`guard-read.sh` is "a guard against the obvious read, not a containment boundary".

Nothing outside this repository asks for them: cezar does not depend on project hooks.

cezar starts Claude Code with `--permission-mode dontAsk`. Claude Code's own `permissions.deny`
rules hold in that mode, apply to every subcommand of a compound command, to `cat`/`sed` and
redirections in Bash as well as to the file tools, and need no parser of ours. `permissions.ask`
prompts a developer and is refused in `dontAsk`, which is the agent-run tier without an environment
check. Checked on 2026-09-24 against the same rule set in `planned.travel`: Read and `cat` of
`.dev.vars`, an Edit of `src/routeTree.gen.ts`, `echo && npx wrangler secret put` and
`git push --force-with-lease` were denied, `.dev.vars.example` stayed readable, and
`wrangler deploy` was refused.

## Decision

1. `git-guardrails.sh`, `guard-read.sh`, `guard-generated.sh` and `.claude/hooks/__tests__/` are
   deleted. `format-file.sh` stays; it formats, it does not guard.
2. `.claude/settings.json` carries the few operations nothing recovers from as `deny` (secrets,
   generated files, history rewrites, `--no-verify`, a written Cloudflare secret, a deleted Cloudflare
   store or Worker) and deploys, remote D1 commands and an edit of the hand-mirrored
   `worker-configuration.d.ts` as `ask`. Refusing rules belong in that file now; it is no longer
   hooks-only.
3. The GitHub Actions tier goes with the hooks: no workflow in `.github/workflows/` runs Claude Code.

## Consequences

- A write outside the worktree is no longer refused. A bare `Edit` or `Write` in `--allowedTools`
  reaches any path the user can write, and Claude Code has no write counterpart to
  `blockReadsOutsideWorkingDirectories`. This is accepted: it is what `guard-generated.sh` caught
  after a pr-autopilot run rewrote eight files in a sibling checkout, and the fix, if it recurs, is
  path-scoped `--allowedTools` in cezar rather than a hook here.
- Reads outside the worktree, environment dumps, `pnpm add`, `git clean -f`, `git branch -D` and
  `git checkout .` are no longer refused. One worktree per run, the PAT scopes, branch protection and
  review of every pull request are what bound them.
- A permission rule matches the command as written, not `bash -c '…'` or `/usr/bin/…` - the same
  gap the hooks had, without the code that pretended to close it.
