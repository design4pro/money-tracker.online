# Cezar on this repository

[open-mercato/cezar](https://github.com/open-mercato/cezar) is the only orchestrator of agent work
here (ADR 0013; label protocol in ADR 0014). It runs on a developer host, checks out one `cez/<id8>`
worktree per run under `.ai/cezar/worktrees/`, and never writes to GitHub itself: every label,
comment and pull request comes from a script in `scripts/agent/`, and the sweeper below is the only
writer that is not a run.

## Install and configure

- Pinned version: `@open-mercato/cezar@0.10.0` (`npx @open-mercato/cezar@0.10.0 serve`). The project
  entry in `~/.cezar/config.json` points at the main checkout; the versioned part is
  `.ai/cezar/config.json` (`baseBranch: develop`, `worktreeRetention: 10`, `maxParallel: 2`,
  `reviewGate: false`, `skillsRepos: []`). Cezar's own `.ai/cezar/.gitignore` keeps run state,
  worktrees and automations out of git; only `config.json` is tracked, so a checkout that already has
  an untracked `config.json` must remove it first.
- Service environment: `CEZ_AUTOMATIONS=1` (the `triage-*` and `implement` automations need it),
  `CEZ_AUTONOMOUS_DEFAULT=0`, and never `GH_TOKEN`, `CLOUDFLARE_*` or `CEZ_ENV_PASSTHROUGH`. Cezar
  copies its own env into the agent's, so a token in the service env is a token in every run.
- Host identity: a dedicated `HOME` whose `gh` holds a fine-grained PAT (Contents, Issues and Pull
  requests read/write, no Workflows), over HTTPS. Commits carry `user.name money-tracker-agent` (set
  by `cez-setup.sh`).
- Ports: each worktree pins one port from **3011-3020** (`cez-port.sh`). 3010 is excluded on purpose -
  `vite.config.ts` binds it with `strictPort`, so it belongs to the developer's own dev server and a
  worktree taking it would fight the person at the keyboard.

## Agent mode

A Claude Code session is an agent run when `CEZ_TASK_ID` (cezar) or `GITHUB_ACTIONS` is set. The
hooks in `.claude/hooks/` then tighten:

- `git-guardrails.sh` also blocks `git add -A|.`, closing keywords (`Closes #n`), every
  `gh issue|pr` mutation, non-GET `gh api`, `pnpm dlx|exec|run`, `npx`, `printenv` and `env` dumps.
- `guard-read.sh` (Read, Glob, Grep) confines reads to the worktree and denies `.dev.vars`, `.env*`,
  cezar run state and `.agent/handoff*`.
- `guard-generated.sh` also refuses edits under `.github/`, `.claude/`, `.husky/`, `.ai/cezar/`,
  `scripts/agent/`, `.npmrc` and `pnpm-workspace.yaml`, on top of the generated files it already
  refuses for everyone (`src/routeTree.gen.ts`, `drizzle/`, `worker-configuration.d.ts`,
  `e2e/__screenshots__/`).

Workflows give the agent a `bashAllowlist` of prefixes; every entry must be safe for any suffix,
which is why the scripts below have closed argument spaces and why repo code always runs under
`env -i` with an explicit variable list (`cez-lib.sh: clean_env`). Every string that reaches GitHub
passes `neutralise` (`@claude` gets a zero-width space) so a run can never summon the
claude-code-action.

## Scripts (`scripts/agent/`)

| script                                          | who runs it                         | what it does                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cez-lib.sh`                                    | sourced                             | repo/worktree/run identity, `mkdir` locks (macOS has no flock), marker-comment upsert, heartbeat, `clean_env`                                                                                                                                                                            |
| `cez-port.sh acquire\|release\|current`         | setup, handback                     | one port per worktree from 3011-3020, pinned in `.agent/port`                                                                                                                                                                                                                            |
| `cez-setup.sh [--no-e2e]`                       | workflow `setup` step               | hooks off, agent identity, `pnpm install --frozen-lockfile --prefer-offline`, routes, then `setup-e2e.sh` on the pinned port (dev server on `127.0.0.1`, pid in `.agent/dev-server.pid`)                                                                                                 |
| `cez-ladder.sh [--skip-e2e] [--no-build]`       | agent (allowlist)                   | up to 3 passes: floor guard, `validate.sh --build --e2e-projects chromium`, narrowed rerun from pass 2 that can only stay red, heartbeat, digest `.agent/ladder-digest.md` (≤ 20 kB)                                                                                                     |
| `cez-test.sh <files>`                           | agent (allowlist)                   | vitest on named files under `env -i`; paths only, no flags                                                                                                                                                                                                                               |
| `cez-reseed.sh`                                 | agent (allowlist)                   | `scripts/seed/seed.mjs --force` + `verify.mjs` on the pinned port                                                                                                                                                                                                                        |
| `gh-ro.sh <path> [--paginate] [--jq]`           | agent (allowlist)                   | GET-only window onto `repos/design4pro/money-tracker.online/{issues,pulls,labels,commits,compare,contents,git/ref,search}`                                                                                                                                                               |
| `cez-claim.sh`                                  | workflow `implement-ticket` (claim) | per-issue lock, refresh onto `origin/develop`, one-call preflight (open, `run: implement`, `ready`/`needs-human`, leaf, no open blocker, no open agent PR); a refusal drops `run:` and comments `refused`; a claim swaps to `in-progress` and adopts a clean `claude/issue-<n>-*` branch |
| `cez-handback.sh [--blocked --reason]`          | agent (allowlist)                   | green: push `claude/issue-<n>-<run8>`, draft PR `agent-pr` (+ `needs-e2e`), `status: review`, `CEZ:PR=<n>`; blocked: WIP pushed, digest, `status: needs-human`; protected paths or `package.json` scripts never push; frees the port                                                     |
| `cez-automations.sh [--dry-run]`                | operator                            | registers `docs/agents/cezar-automations.json` with the running cezar over its API (create enabled or update in place)                                                                                                                                                                   |
| `cez-triage-claim.sh`                           | workflow `triage` (claim)           | per-issue lock, refresh onto `origin/develop`, preflight (open, leaf, not held, not in review); without `run: triage` only `status: triage` without the `<!-- agent-triage -->` marker qualifies, and a stand-down writes nothing                                                        |
| `triage-apply.sh [--check]`                     | agent (allowlist)                   | the only writer of a verdict: `.agent/triage.json` + `triage/notes.md` (+ `triage/brief.md`, a `ticket/v2` body, for `promoted`) → the `<!-- agent-triage -->` comment, the brief into the body, `status: ready \| needs-info \| backlog \| needs-human`; never closes                   |
| `triage-batch.sh [--limit N] [--dry-run]`       | operator                            | adds `run: triage` to the oldest `status: triage` issues that lack it, N at a time                                                                                                                                                                                                       |
| `cez-plan-claim.sh`                             | workflow `plan` (claim)             | refresh onto `origin/develop`, `status: * → in-progress`, claim comment with heartbeat, `.agent/issue`                                                                                                                                                                                   |
| `cez-plan-handback.sh --blocked --reason`       | agent (allowlist)                   | `status: needs-human` plus `<!-- agent-result: needs-human -->` when a plan run cannot finish (autonomy nudge, unmet precondition, human gone)                                                                                                                                           |
| `publish-spec.sh`, `publish-prd.sh` `[--check]` | agent (allowlist)                   | validate `.agent/plan/{spec,prd}.md` against `spec/v1` / `prd/v1`, write the body (original request kept in `<details>`), grilling log as `<!-- agent-grilling -->`, `status: review`                                                                                                    |
| `publish-tickets.sh [--check\|--dry-run]`       | agent (allowlist)                   | `plan.mjs`: DAG, disjoint owned paths for parallel tickets, sizes, protected paths, no `Closes`; create as `queued` → `sub_issues` → `blocked_by` → verify → first wave `ready` → PRD `in-progress`; resumable through `<!-- agent-tickets -->`                                          |
| `cez-docs-pr.sh`                                | agent (allowlist)                   | cherry-picks the run's `CONTEXT.md` / `docs/adr/` commits onto `claude/docs-<n>-<run8>` off `origin/develop` and opens a draft PR labelled `agent-docs`                                                                                                                                  |
| `floor-guard.mjs [--base]`                      | ladder                              | refuses added `@ts-*` / eslint suppressions, skipped or focused tests, deleted test files                                                                                                                                                                                                |
| `state.mjs`                                     | sweeper, tests                      | the invariants I-1…I-10 and the PR-driven transitions as a pure function of a snapshot and `now`                                                                                                                                                                                         |
| `sweep.mjs [--fix] [--json] [--strict]`         | launchd on the host                 | gathers GitHub + `GET /api/v1/p/money-tracker/runs`, reports, applies the mechanical fixes with `--fix`                                                                                                                                                                                  |
| `validate.sh`, `setup-e2e.sh`, `narrow-e2e.ts`  | ladder                              | the deterministic ladder: route-tree gate, migration-drift gate, typecheck, lint, vitest, `--build`, and chromium e2e when the diff touches UI                                                                                                                                           |
| `labels-migrate.sh`                             | operator                            | the one-off label migration of ADR 0014, dry-run by default                                                                                                                                                                                                                              |

Everything under `scripts/agent/__tests__/` runs in the `tooling` vitest project (`pnpm test`), which
is what keeps the claim preflight, the label decisions, the ladder shape and the hooks honest.

## Workflow `plan`

`.ai/cezar/workflows/plan.yml` turns one issue into a spec, then a PRD, then tickets, one mode per
run and a human at the cockpit throughout. Start it from the GitHub tab: issue → "Hand this to the
agent" → workflow `plan`, prompt `spec`, `prd` or `tickets` (the issue number and link are always
sent), **Autonomous off**. The steps are `claim` (command), `setup --no-e2e` (command) and the
interactive `/plan-feature {{task}}` (opus), which is last because only the last agent step may park
on `CEZ:ASK`.

- The skill (`.claude/skills/plan-feature/`, one mode file each) grills one question per round with a
  recommended option, logs the rounds, and publishes only through the scripts above; each artefact
  ends at `status: review`, and the human starts the next mode by handing the issue over again.
- A run that receives the autonomous nudge refuses: `cez-plan-handback.sh --blocked` marks the issue
  `needs-human`. The same skill runs locally in `claude` (`/plan-feature <issue> spec`) with
  AskUserQuestion instead of `CEZ:ASK`; write `.agent/issue` first.
- Tickets are created as `status: queued` and become `ready` only after `sub_issues` and `blocked_by`
  are verified on GitHub, so no implement run can start ahead of its blockers.

## Workflow `implement-ticket`

`.ai/cezar/workflows/implement-ticket.yml` turns one ready ticket into one draft PR without a human
in the loop: `claim` (command), `setup` (command, full e2e environment on a pooled port), then the
autonomous `/implement-ticket {{task}}` (opus). It starts when a human adds `run: implement` to a
ticket: the `implement` automation (`docs/agents/cezar-automations.json`, registered with
`scripts/agent/cez-automations.sh` once the service runs with `CEZ_AUTOMATIONS=1`) polls GitHub every
60 s for that label change and skips anything `in-progress`, `review` or `prd`. `auto-advance` on a
PRD lets the sweeper add the label to children as they unblock.

- The claim is the only gate and it costs no tokens: a refusal (blocked, queued, a PR already open,
  not a leaf) removes `run: implement`, comments `<!-- agent-result: refused -->` and exits 1, so the
  sweeper never has to escalate a stuck label.
- The skill (`.claude/skills/implement-ticket/`) works inside the ticket's Owned paths, TDD-first,
  climbs `cez-ladder.sh` at most three times, self-reviews, and always leaves through
  `cez-handback.sh`: green means a draft PR with the DoD, the ladder table and the review in its body;
  a stop condition (`ladder-exhausted`, `outside-owned-paths`, `spec-conflict`, `floor`, `dependency`,
  `security`, `infra`) means a pushed WIP branch and `status: needs-human` with the digest.
- The handback refuses a tree the ladder did not see (`.agent/ladder-tree`) and never pushes a diff
  that touches the agent's own configuration or `package.json` scripts. A ticket with a "Visual change
  expected" section gets a baseline note in the PR; the human re-records with `pnpm e2e:update` or the
  update-snapshots workflow.
- Locally the same skill runs as `/implement-ticket <issue>` on a branch off `origin/develop` with
  `.agent/issue` written by hand; the handback then uses the developer's `gh`.

## Workflow `triage`

`.ai/cezar/workflows/triage.yml` verifies one new issue against HEAD and routes it, without a human
in the loop: `claim` (command), `setup --no-e2e` (command), then the autonomous
`/triage-ticket {{task}}` (sonnet) with a read-mostly allowlist (`cez-test.sh`, the `pnpm` checks,
`triage-apply.sh`). Two automations start it: `triage-opened` (`issue.opened` carrying
`status: triage`) and `triage-relabel` (`issue.labeled` with `run: triage`, skipping `in-progress`
and `review`). The backlog is fed a few at a time with `triage-batch.sh`.

- The skill reproduces the claim (a temporary vitest case at the seam, or the command the body names),
  checks redundancy across open and closed issues and `docs/agents/out-of-scope.md`, and writes a
  verdict: `promoted` (with a `ticket/v2` agent brief), `needs-info`, `needs-plan` (every feature),
  `needs-human`, `refuted`, `redundant`. Nothing closes an issue; a human does that from
  `needs-human`.
- `triage-apply.sh` is the only writer: it validates the brief with the same checks as a planned
  ticket, keeps the original report in the body, posts the notes as `<!-- agent-triage -->` (edited in
  place on a repeat) and swaps the status. A promoted bug then looks like any ready ticket to
  `run: implement`.
- The marker blocks only the `opened` path; `run: triage` from a human re-triages on purpose, so a
  reply to a `needs-info` question is followed by that one label.
- **Sentry findings have no route in yet.** They used to arrive through the orchestrator's weekly
  sweep, which ADR 0013 removed along with it. Until a replacement exists a Sentry issue is filed by
  hand as `type: bug` + `status: triage`, and the `triage-opened` automation picks it up like any
  other.

## Sweeper

`node scripts/agent/sweep.mjs` runs every 15 minutes on the cezar host with the host's `gh` identity.
It reads GitHub (issues, PRs, claim comments, label timeline) and cezar's run list; when cezar is
unreachable it reports and never escalates. Report mode prints violations and the actions `--fix`
would take; `--strict` exits 1 when anything is off.

Install (template in `scripts/agent/launchd/`):

```bash
sed -e "s|__REPO_ROOT__|$PWD|g" -e "s|__PATH__|$(dirname "$(command -v node)"):$(dirname "$(command -v gh)"):/usr/bin:/bin|g" \
  scripts/agent/launchd/dev.money-tracker.sweeper.plist > ~/Library/LaunchAgents/dev.money-tracker.sweeper.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.money-tracker.sweeper.plist
```

Remove with `launchctl bootout gui/$(id -u)/dev.money-tracker.sweeper`. Log:
`.ai/cezar/tmp/sweeper.log`.

## Markers

Comments the scripts edit in place rather than repeat: `<!-- agent-claim: <runId> -->` with
`<!-- agent-heartbeat: ISO -->` inside it (written by `cez-setup.sh`, `cez-ladder.sh`,
`cez-reseed.sh`), `<!-- agent-result: ok|needs-human|refused -->`, `<!-- agent-triage -->`,
`<!-- agent-grilling -->`, `<!-- agent-noticed -->`, `<!-- sweeper: <code> -->`; in a PR body
`<!-- agent-run: <runId> -->`.
