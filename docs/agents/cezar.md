# Cezar on this repository

[open-mercato/cezar](https://github.com/open-mercato/cezar) is the only orchestrator of agent work
here (ADR 0013); the work itself is done by the `om-*` skills from
[open-mercato/skills](https://github.com/open-mercato/skills) (ADR 0017). Cezar runs on a developer
host, checks out one `cez/<id8>` worktree per run under `.ai/cezar/worktrees/`, polls GitHub for
the events in `docs/agents/cezar-automations.json`, and runs the workflow the event names. Every
label, comment and pull request comes from a skill acting through `.ai/trackers/github.md` under
the rules of `SDLC.md`.

## Install and configure

- Pinned version: `@open-mercato/cezar@0.10.1` (`npx -y @open-mercato/cezar@0.10.1 serve`). The
  project entry in `~/.cezar/config.json` points at the main checkout; the versioned part is
  `.ai/cezar/config.json` (`baseBranch: develop`, `worktreeRetention: 10`, `maxParallel: 2`,
  `reviewGate: true`, which gates only non-autonomous runs, `skillsRepos: []`). Cezar's own
  `.ai/cezar/.gitignore` keeps run state, worktrees and its automations store out of git;
  `config.json` and `workflows/` are tracked.
- Skills: `pnpm install-skills` installs the collection into `.agents/skills/` and links every
  `om-*` skill into `.claude/skills/`; both are gitignored, so every worktree installs its own copy
  in the workflow's setup step. Repo specifics live in `.ai/skills/om-<name>/SKILL.md` as
  extensions of the installed skill. After an upgrade, read the diff with `/om-apply-upgrade-notes`.
- Service environment: `CEZ_AUTOMATIONS=1`, `CEZ_AUTONOMOUS_DEFAULT=0`, `HUSKY=0`, and never
  `GH_TOKEN`, `CLOUDFLARE_*` or `CEZ_ENV_PASSTHROUGH`. Cezar copies its own env into the agent's,
  so a token in the service env is a token in every run. `HUSKY=0` keeps a worktree's
  `pnpm install` from running `prepare`, which would rewrite `core.hooksPath` in the host clone's
  shared config, and makes husky skip its hooks inside a run: the gate a run passes is
  `validation.commands` in `.ai/agentic.config.json`, not pre-commit.
- Host identity: a dedicated `HOME` whose `gh` holds a fine-grained PAT (Contents, Issues and Pull
  requests read/write; **no Workflows, no Administration**: a run cannot push under
  `.github/workflows/` or delete a label), over HTTPS. Commits carry `user.name
money-tracker-agent` from that HOME's global git config.
- Ports: the test environment (`.ai/scripts/test-env-up.sh`, the `om-prepare-test-env` contract)
  takes the first free port from **3011-3020**. 3010 is excluded on purpose: `vite.config.ts`
  binds it with `strictPort`, so it belongs to the developer's own dev server.

### The cockpit process

One cezar per host, not one per project. `cez serve` binds 127.0.0.1:4321 and answers
`GET /api/v1/p/<id>/runs` for every repo in `cezar projects`, so a second checkout wants
`cezar projects add <repo root>`, not a second cockpit (the second silently binds :4322 and both
write the same `.ai/cezar/` state). The `<id>` is `money-tracker-online`: cezar slugs it from the
checkout's directory basename. Every script here defaults to it and takes `CEZ_PROJECT` as the
override; `GET /api/v1/projects` is the authority when a host disagrees.

Install it as a launchd job (template in `scripts/cezar/launchd/`, once per host):

```bash
sed -e "s|__NPX__|$(command -v npx)|g" -e "s|__REPO_ROOT__|$PWD|g" -e "s|__HOME__|$HOME|g" \
  -e "s|__PATH__|$(dirname "$(command -v node)"):$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin|g" \
  scripts/cezar/launchd/dev.cezar.cockpit.plist > ~/Library/LaunchAgents/dev.cezar.cockpit.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.cezar.cockpit.plist
```

The `PATH` must carry everything a run spawns (`node`, `claude`, `git`, `gh`, `pnpm`), because
the job deliberately does not go through a login shell. `KeepAlive` means `bootout` is how you
stop it; `kickstart -k gui/$(id -u)/dev.cezar.cockpit` is the restart after a version bump or an
edit to the plist. Once it is installed, stop running bare `cezar` in a repo. Log:
`~/Library/Logs/cezar-cockpit.log`.

## Agent mode

A Claude Code session is an agent run when `CEZ_TASK_ID` (cezar) or `GITHUB_ACTIONS` is set. The
hooks in `.claude/hooks/` then tighten:

- `git-guardrails.sh` also blocks `pnpm add|remove|update` (the stack is pinned, `docs/SPEC.md`
  §3), `printenv` and `env` dumps. For everyone it blocks force-pushes to `develop`/`main`,
  `git reset --hard`, `git clean -f`, `git branch -D`, `git checkout/restore .` and `--no-verify`.
  GitHub mutations, `git add -A`, closing keywords and `pnpm exec` are open: the om skills perform
  them through the tracker descriptor and `SDLC.md` governs them.
- `guard-read.sh` (Read, Glob, Grep) confines reads to the worktree and denies `.dev.vars`,
  `.env*`, cezar run state and `.ai/qa/test-env.env`. `.ai/runs`, `.ai/analysis`, `.ai/qa` and
  `.ai/tmp` stay readable: the skills write their artefacts there.
- `guard-generated.sh` also refuses edits under `.github/`, `.claude/`, `.husky/`, `.ai/cezar/`,
  `.ai/agentic.config.json`, `.ai/trackers/`, `.ai/browsers/`, `.ai/skills/`, `.ai/scripts/` (a
  run must not rewrite its own validation gate), `scripts/cezar/`, `.npmrc`,
  `pnpm-workspace.yaml`, `docs/agents/reference.md` and `docs/agents/out-of-scope.md`, on top of
  the generated files it refuses for everyone.

Agent steps carry no `bashAllowlist` (ADR 0017): the tracker descriptor is shell functions and
`jq`, and a prefix allowlist would drop label mutations silently. The hooks, the `deny` list in
`.claude/settings.json`, the PAT scopes, one worktree per run and `maxParallel: 2` are the gate.
`.claude/hooks/__tests__/hooks.test.ts` (vitest project `tooling`) holds the hooks' contract.

## Workflows (`.ai/cezar/workflows/`)

Every workflow is a setup step (`HUSKY=0 pnpm install --frozen-lockfile --prefer-offline && pnpm
install-skills`) and one agent step whose prompt is the skill as a slash command (`/om-… {{task}}`;
never `skill:`, which would load the thin `.ai/skills/` override alone). `allowedTools` is the
full set for skills that write code and drops `Edit`/`Write` for the ones that must not.

| Workflow          | Agent step                        | Model  | Started by                                                                   |
| ----------------- | --------------------------------- | ------ | ---------------------------------------------------------------------------- |
| `om-manage-issue` | `/om-auto-manage-issues {{task}}` | sonnet | automation `issue-opened`; or a human with an issue number                   |
| `om-fix-issue`    | `/om-auto-fix-issue {{task}}`     | opus   | a human, from the cockpit, with the issue number as the task                 |
| `om-review-pr`    | `/om-auto-review-pr {{task}}`     | sonnet | automation `pr-opened`; or a human with a PR number                          |
| `om-autopilot`    | `/om-pr-autopilot {{task}}`       | opus   | a human, on a stalled PR (red CI, changes requested, conflict); never merges |
| `om-plan`         | `/om-brainstorm {{task}}`         | opus   | a human, **Autonomous off**, with the idea as the task                       |

**Starting a run.** GitHub tab → issue → "Hand this to the agent" → workflow → the task box. The
cockpit pre-fills the box with `Fix GitHub issue #<n>: <title>` and the URL; leave it or replace
it with the bare number. Both name exactly one issue, which the `om-auto-fix-issue` override treats
as the issue reference (a free-text brief would make the skill create a new issue). An automation
sends `{{github.number}}`, the number alone.

Implementation has no label trigger on purpose: in the om taxonomy no label means "start", and a
human hands an issue over from the cockpit, the way `om-auto-fix-issue <n>` is typed upstream.
Whether an `issue.labeled` automation earns its place is a decision for `/om-pipeline-retro`
after the first weeks.

**Merge and after.** `om-merge-buddy` reports what is mergeable; a human runs
`/om-approve-merge-pr <n>` (squash to `develop`), then `/om-close-fixed-issues` (Cezar has no
`pull_request.merged` event and no scheduler, so this is the merger's step, `SDLC.md`) and
`/om-followup-issue-from-pr` when the PR left something behind. `needs-qa` without `qa-approved`
never merges, and only a human sets `qa-approved`: the blind pair is
`node scripts/visual/capture.mjs` (ADR 0016).

## Automations (`docs/agents/cezar-automations.json`)

Registered with the running cockpit by `scripts/cezar/automations.sh` (`--dry-run` first;
idempotent: update in place or create enabled; it lists definitions the cockpit holds that the
file no longer names). Two definitions:

- `issue-opened` (`issue.opened`) → `om-manage-issue`, with `authors` naming the human
  maintainers. The agent step holds Bash with no allowlist and the issue body is its input, so an
  issue anyone on GitHub can open must not start a run by itself; an outside report is handled
  from the cockpit by a human.
- `pr-opened` (`pull_request.opened`) → `om-review-pr`, again with `authors`. Agent PRs are
  reviewed inside their own chain and Dependabot's carry nothing to review by hand.

Every filter excludes `in-progress`; `lookbackDays: 3` and `maxRecords` bound a mistaken burst to
a handful of runs. The poller needs `CEZ_AUTOMATIONS=1` in the service env (a 409 from the API
says it is missing).

## Host cutover (operator, once, when PR B merges)

The old process keeps working until this is done, and the new one does not work before it: the
issue forms and the skills name labels that must exist, and the old automations would keep
claiming issues the new ones handle.

1. If the sweeper is installed: `launchctl bootout gui/$(id -u)/dev.money-tracker.sweeper` and
   delete `~/Library/LaunchAgents/dev.money-tracker.sweeper.plist`.
2. In the cockpit (Automations) delete `triage-opened`, `triage-relabel` and `implement`; their
   workflows are gone from the tree.
3. Labels. The 27 SDLC labels already exist (created ahead of the merge; `ensure-label-taxonomy`
   in `.ai/trackers/github.md` repairs them). Relabel the open items, then delete the old set:

   ```bash
   gh issue list --state open --limit 100 --json number,labels \
     --jq '.[] | "\(.number) \([.labels[].name] | join(","))"'
   # per issue: gh issue edit <n> --remove-label "status: <x>,type: bug" --add-label bug
   # type: bug → bug; type: enhancement, type: feature → feature; type: maintenance → refactor
   # a held issue → blocked; everything else loses its status: label without replacement
   # open Dependabot PRs: --remove-label "type: maintenance" --add-label dependencies
   for l in 'status: triage' 'status: needs-info' 'status: backlog' 'status: queued' \
     'status: ready' 'status: in-progress' 'status: review' 'status: needs-human' \
     'run: triage' 'run: implement' 'type: bug' 'type: enhancement' 'type: feature' \
     'type: maintenance' prd auto-advance agent-pr agent-docs needs-e2e; do
     gh label delete "$l" --yes
   done
   gh label list --limit 100 | wc -l   # 27
   ```

   Then `/om-auto-manage-issues` over the open issues adds the missing priority and risk.

4. Re-render the cockpit plist from the template (it pins 0.10.1 and adds `HUSKY=0`),
   `launchctl bootout gui/$(id -u)/dev.cezar.cockpit`, `bootstrap` it again, and check
   `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/api/v1/p/money-tracker-online/runs`
   answers 200. On the host clone, `git config core.hooksPath` should be unset or `.husky/_`;
   either is fine with `HUSKY=0`.
5. `scripts/cezar/automations.sh --dry-run`, then without the flag: `issue-opened` and `pr-opened`
   are created enabled.
6. Verify end to end: open a test issue with the Bug form → within a minute an `om-manage-issue`
   run adds priority and risk and comments its analysis → hand it to `om-fix-issue` → the run
   claims with `in-progress`, opens a PR on `develop` with `Closes #n`, `bug`, `review` or
   `merge-queue`, `needs-qa` or `skip-qa`, priority and risk, a review from `om-auto-review-pr`,
   and ends with the `PR: #n` line in the cezar run. Nothing in its log mentions husky or
   lint-staged, and no duplicate issue appeared.

## Local use

Every workflow's skill runs the same way in a local `claude` session, with the developer's `gh`:
`/om-auto-fix-issue <n>`, `/om-auto-manage-issues <n>`, `/om-auto-review-pr <pr> [--autofix]`,
`/om-pr-autopilot <pr>`, `/om-brainstorm`, `/om-spec-writing`, `/om-prepare-issue`,
`/om-merge-buddy`, `/om-approve-merge-pr <pr>`, `/om-close-fixed-issues`. Hand-worked branches go
through `/om-check-and-commit` and `/om-open-pr`. The hooks are the project's, so nothing depends
on the host's user-level configuration.

A workflow can also run headless without the cockpit: `npx -y @open-mercato/cezar@0.10.1 run "21"
--workflow om-manage-issue --repo .`. It creates the same isolated worktree, cut from
`baseBranch`, not from the checkout you run it in, so a workflow or om config that only exists on a
feature branch is not in that worktree until the branch merges (the 2026-09-06 trial of
`om-manage-issue` on #21 pointed `baseBranch` at the branch for the run and reverted it). The run
uses your own `gh` identity, and `review` is terminal for it.
