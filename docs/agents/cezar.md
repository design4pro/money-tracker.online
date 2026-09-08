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
  `reviewGate: false`, so a finished run settles straight to `done` rather than parking at
  `review` for a human to accept the diff; the gate only ever applied to non-autonomous runs,
  and partial automation is the point, `systemPrompt`, which is prepended to every run's prompt
  and is where the language contract lives, and `skillsRepos`, which is deliberately empty:
  listing a repository there hands `.claude/skills/` to the cockpit, which then replaces the
  vendored `om-*` tree. The collection's SHA lives in `skills-lock.json` alone)). Cezar's own
  `.ai/cezar/.gitignore` keeps run state, worktrees and its automations store out of git;
  `config.json` and `workflows/` are tracked.
- Host patches: `bash .ai/scripts/cezar-host-patch.sh` patches the cached copy of 0.10.1 the
  service runs, puts `CEZ_SKILLS_AUTO_UPDATE=0` in the service plist and restarts it. Rerun it
  after the npx cache is cleared; drop each patch once the pinned version carries the fix. The
  cockpit is one per host and shared with `planned.travel`, whose copy of the script is identical
  apart from one paragraph of its header — running either is enough.
  - `issue.labeled` polls fail as soon as one recently updated issue has a comment or a
    cross-reference (open-mercato/cezar#914, fix in upstream PR #916, unreleased), so
    `issue-regroom`, `issue-autofix` and `issue-spec` never fire.
  - On every cockpit start the skills coordinator runs `npx skills check <om-*> -p` in each project
    root, and that command re-adds the skills from upstream HEAD: the vendored
    `.claude/skills/om-*` directories become symlinks into an untracked `.agents/skills/`, which
    shows as hundreds of deleted files in `git status`. `skillsAutoUpdate: false` (kept in
    `~/.cezar/config.json`) gates only the update; the patch makes `CEZ_SKILLS_AUTO_UPDATE=0` skip
    the check too. Recovery: remove the symlinks, `git checkout -- .claude/skills`, delete `.agents/`.
  - A label event on a pull request never reaches an automation: the poller asks for `is:issue` and
    then drops any hit carrying `pull_request`, so `pull_request.opened` is the only PR trigger
    stock cezar has. The patch teaches both gates a `filters.includePullRequests` flag, opt-in per
    automation, which `pr-review-threads` sets and nothing else does.
- Skills: `.claude/skills/om-*` are vendored files, byte-identical to the pinned upstream SHA, and
  `skills-lock.json` records it. A worktree therefore has the collection the moment it is cut, and
  the workflow's setup step installs dependencies only. `pnpm install-skills` re-installs and
  updates them; the diff is a PR, read with `/om-apply-upgrade-notes`, and `skills-lock.json`
  moves in the same commit. Repo specifics live in
  `.ai/skills/om-<name>/SKILL.md` as extensions of the installed skill, never as a fork.
- Service environment: `CEZ_AUTOMATIONS=1`, `CEZ_AUTONOMOUS_DEFAULT=0`, `CEZ_SKILLS_AUTO_UPDATE=0`,
  `GH_CONFIG_DIR` (below), and never `GH_TOKEN`, `CLOUDFLARE_*` or `CEZ_ENV_PASSTHROUGH`. Cezar
  builds the agent's env from an allowlist (`PATH`, `HOME`, toolchain prefixes such as
  `NODE_*`/`PNPM_*`, `GH_TOKEN`, `GH_CONFIG_DIR`, `ANTHROPIC_*`,
  `CLAUDE_*`, `CEZ_*`), so a token in the service env is a token in every run, and any other
  variable set there (`HUSKY=0` for one) never reaches the agent. Husky is therefore handled in
  the repo: `HUSKY=0` inline in every workflow's setup step keeps `pnpm install` from running
  `prepare`, which would rewrite `core.hooksPath` in the host clone's shared config, and
  `.husky/pre-commit` exits at once when `CEZ_TASK_ID` is set. The gate a run passes is
  `validation.commands` in `.ai/agentic.config.json`, not pre-commit: the first `om-fix-issue`
  run (PR #64) paid for lint-staged, typecheck and the full test run on every commit, and the
  test run flaked under the load of a second worktree.
- Host identity: the cockpit acts as `design4pro-agent` (bot@design4.pro), a member of the
  `design4pro` organisation with Write on this repository and on `planned.travel`, nothing else.
  Its `gh` login lives in its own config directory, next to the developer's: `mkdir -p
~/.config/gh-agent && GH_CONFIG_DIR=~/.config/gh-agent gh auth login --with-token`, pasting a
  fine-grained PAT owned by that account (resource owner `design4pro`, only the two repositories,
  Contents, Issues and Pull requests read/write; **no Workflows, no Administration**: a run cannot
  push under `.github/workflows/` or delete a label; the organisation approves the token once,
  under Settings → Personal access tokens). The plist sets `GH_CONFIG_DIR` and cezar forwards it,
  so `gh` inside a run and `git push` over HTTPS (the global credential helper is `gh auth
git-credential`, which reads the same variable) both act as the bot, while `~/.config/gh` and
  the developer's terminal stay the developer's. Commits carry `user.name design4pro-agent` and
  `user.email bot@design4.pro` from the host clone's local git config, which every worktree
  shares.
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

Install it as a launchd job (template in `.ai/scripts/launchd/`, once per host):

```bash
sed -e "s|__NPX__|$(command -v npx)|g" -e "s|__REPO_ROOT__|$PWD|g" -e "s|__HOME__|$HOME|g" \
  -e "s|__PATH__|$(dirname "$(command -v node)"):$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin|g" \
  .ai/scripts/launchd/dev.cezar.cockpit.plist > ~/Library/LaunchAgents/dev.cezar.cockpit.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.cezar.cockpit.plist
```

The `PATH` must carry everything a run spawns (`node`, `claude`, `git`, `gh`, `pnpm`), because
the job deliberately does not go through a login shell. `KeepAlive` means `bootout` is how you
stop it; `kickstart -k gui/$(id -u)/dev.cezar.cockpit` is the restart after a version bump or an
edit to the plist. Once it is installed, stop running bare `cezar` in a repo. Log:
`~/Library/Logs/cezar-cockpit.log`.

## Agent mode

A Claude Code session is an agent run when `CEZ_TASK_ID` (cezar) or `GITHUB_ACTIONS` is set.
`.husky/pre-commit` skips itself under `CEZ_TASK_ID` (`validation.commands` is the run's gate),
and the hooks in `.claude/hooks/` tighten:

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
  run must not rewrite its own validation gate), `.npmrc`,
  `pnpm-workspace.yaml`, `docs/agents/reference.md` and `docs/agents/out-of-scope.md`, on top of
  the generated files it refuses for everyone.

  One exception, and only in a cezar run: a guarded file **this branch already changes**. A
  reviewer asking for a correction to a change a human proposed is not a run rewriting its own
  rules, and refusing it is how a review thread stays open forever - the `develop` ruleset merges
  nothing with one. Introducing a change to a guarded file the branch does not already carry is
  still refused, and under `GITHUB_ACTIONS` the block is absolute, because there the diff is the
  attacker's and "the branch already changes it" is the attacker's own claim.

Agent steps carry no `bashAllowlist` (ADR 0017): the tracker descriptor is shell functions and
`jq`, and a prefix allowlist would drop label mutations silently. The hooks in `.claude/hooks/`,
the PAT scopes, one worktree per run and `maxParallel: 2` are the gate. `.claude/settings.json`
carries no permission rules; it is hooks-only, and the rules a `deny` list used to hold moved into
`git-guardrails.sh` and `guard-read.sh`, which see the whole command rather than a prefix.
`.claude/hooks/__tests__/hooks.test.ts` (vitest project `tooling`) holds the hooks' contract.

## Workflows (`.ai/cezar/workflows/`)

Every workflow is a setup step (`HUSKY=0 pnpm install --frozen-lockfile --prefer-offline && pnpm
generate-routes`) and one agent step whose prompt is the skill as a slash command (`/om-… {{task}}`;
never `skill:`, which would load the thin `.ai/skills/` override alone). `allowedTools` is the
full set for skills that write code and drops `Edit`/`Write` for the ones that must not. The tree
is the same nine workflows as `planned.travel`, under the same names; the setup step differs only
where that repository provisions D1 and a basemap it needs and this one does not.

| Workflow         | Agent step                                                               | Model                | Started by                                                                 |
| ---------------- | ------------------------------------------------------------------------ | -------------------- | -------------------------------------------------------------------------- |
| `issue-groom`    | `/om-auto-manage-issues {{task}} --prep-impl`                            | sonnet               | automation `issue-groom` (`issue.opened`), `issue-regroom` (label `groom`) |
| `issue-autofix`  | `/om-auto-fix-issue {{task}}`                                            | opus                 | automation `issue-autofix` (label `autofix`)                               |
| `spec`           | `/om-auto-write-spec {{task}}`                                           | opus                 | automation `issue-spec` (label `spec` on a `feature`)                      |
| `implement-spec` | `/om-auto-implement-spec {{task}}`                                       | opus                 | a human, from the cockpit, after the spec PR merged                        |
| `pr-autopilot`   | `/om-pr-autopilot {{task}}` (no `--allow-merge`)                         | opus                 | automation `pr-autopilot` (`pull_request.opened` by a human maintainer)    |
| `pr-review`      | `/om-auto-review-pr {{task}} --autofix`                                  | opus                 | a human, from the cockpit, on a PR number                                  |
| `pr-fix`         | `/om-auto-fix-pr {{task}}`                                               | opus                 | automation `pr-review-threads` (label `review-threads` on a PR)            |
| `housekeeping`   | `/om-review-prs`, `/om-merge-buddy`, `/om-close-fixed-issues --limit 50` | opus, sonnet, sonnet | launchd via `.ai/scripts/housekeeping.sh`, or a human                      |
| `brainstorm`     | `/om-brainstorm {{task}}`, **Autonomous off**                            | opus                 | a human, from the cockpit, with the idea as the task                       |

The task text an automation sends is the issue or PR number alone (`{{github.number}}`); a second
token would read as a brief to `om-auto-fix-issue`, which is why the cockpit's pre-filled
`Fix GitHub issue #<n>: <title>` is safe only because the `om-auto-fix-issue` override treats a
text naming exactly one issue of this repository as an issue reference. From the cockpit type the
same: a number, a spec path, or for `brainstorm` the idea.

**Starting a run.** GitHub tab → issue → "Hand this to the agent" → workflow → the task box.
Implementation also has a label trigger: `autofix` on an issue starts `issue-autofix` without the
cockpit. The four command labels (`groom`, `autofix`, `spec` on an issue, `review-threads` on a
PR) are the only things that start code-writing work, and no skill adds them (the `.ai/skills/`
overrides say so), so no run can start another.

**Merge and after.** `om-merge-buddy` reports what is mergeable; a human runs
`/om-approve-merge-pr <n>` (squash to `develop`), then `/om-close-fixed-issues` closes what the
merge did not — Cezar has no `pull_request.merged` event, and `develop` is not the default branch,
so nothing closes natively. Housekeeping runs both three times a day, so this is the merger's step
only between those runs (`SDLC.md`). `needs-qa` without `qa-approved` never merges, and only a
human sets `qa-approved`: the blind pair is `node scripts/visual/capture.mjs` (ADR 0016).

## Automations (`docs/agents/cezar-automations.json`)

Registered with the running cockpit by `.ai/scripts/cez-automations.sh` (`--dry-run` first;
idempotent: update in place or create enabled; it lists definitions the cockpit holds that the
file no longer names). Six definitions: `issue-groom` on `issue.opened` with `authors` naming the
human maintainers; `issue-regroom`, `issue-autofix`, `issue-spec` on `issue.labeled` with
`changedLabels` `groom` / `autofix` / `spec`; `pr-autopilot` on `pull_request.opened`, again with
`authors`; `pr-review-threads` on `issue.labeled` with `changedLabels` `review-threads` and
`includePullRequests`, the only one that fires on a PR.

Every trigger is gated on who can produce it: the open events by author, the label events because
only a collaborator can set a label. This matters because the agent step holds Bash with no
allowlist and the issue body is its prompt: an issue anyone on GitHub can open must not start a run
by itself, so an external report is groomed when a maintainer adds `groom`. The skill that reacts
removes its own command label as its first tracker mutation, so a label still present means nobody
picked the issue up.

`pr-review-threads` is the one automation whose trigger stock cezar cannot deliver: the poller
drops every label event on a pull request, so it needs patch 4 in `.ai/scripts/cezar-host-patch.sh`
and the `includePullRequests` flag in its own filters. Unlike `planned.travel`, this repository has
no review job that applies `review-threads` on its own and its `develop` ruleset does not carry
`required_review_thread_resolution`, so the label is a human's call on a PR whose review left live
threads, and an open thread blocks nothing but `om-auto-fix-pr`'s own exit criterion
(`.ai/skills/om-auto-fix-pr/SKILL.md`).

Agent PRs (authored by `design4pro-agent`, already reviewed inside their own chain) and Dependabot
never enter the autopilot, and the pipeline labels stay excluded because the poller re-checks labels
on every poll: while the cockpit still ran under the maintainer's `gh`, the first `om-fix-issue` run
got a second review the moment its `in-progress` lock lifted. Every filter excludes `in-progress`;
`lookbackDays: 3` and `maxRecords` 5-10 bound a mistaken burst to a handful of runs. The poller
needs `CEZ_AUTOMATIONS=1` in the service env (a 409 from the API says it is missing).

A review or autopilot run checks out the PR's head, hooks included: a branch cut before the om
cutover (`f2a258e`) carries the old `git-guardrails.sh`, which blocks every GitHub write in agent
mode, and the run ends in a question nobody answers (PR #67, 2026-09-07). Merge `develop` into such
a branch before opening the PR.

## Prompt templates (`docs/agents/cezar-prompt-templates.json`)

Installed into the cockpit by `.ai/scripts/cez-prompt-templates.sh` (`--dry-run` lists what it would
write). One template per `om-*` skill, 37 of them: the task text with its argument placeholder, the
flags, and the preconditions the skill's `SKILL.md` and its `.ai/skills/` override state, phrased as
directives because the text is sent as the task. They replace cezar's five generic built-ins. The
installer `PUT`s `promptTemplates` to `/api/v1/p/money-tracker-online/ui-state`, which merges
shallowly at the top level, so it rewrites that one array and leaves every other preference alone;
the store is `.ai/cezar/ui-state.json`, which is gitignored because it also accumulates
per-developer state (`skillUsage`, `lastTask`, `appearance`). Edit the tracked JSON and re-run the
script — never the ui-state file by hand.

Cezar's normalizer truncates and drops silently, so the script checks the caps first: at most 50
templates, `label` 80 characters, `text` 2000, ids unique and matching an installed skill — which
`.claude/skills/om-*` carries in the checkout, so that last check needs no install step.

A template whose `skills` array names the skill selected in the composer is applied automatically,
but only while the composer is still pristine. That is why only the 19 skills taking a free-text
brief or no argument carry `skills`; the 18 that take an issue number, a PR number, a spec path or
a URL carry none and are reached through "Insert a template". From the GitHub issue or PR panel an
auto-applied template lands as `<number>` + the template text, and a second token there reads as a
brief to `om-auto-fix-issue` — the same hazard the automations avoid by sending `{{github.number}}`
alone.

## Housekeeping

Cezar has no scheduler. `.ai/scripts/housekeeping.sh` POSTs one `housekeeping` run to the cockpit
(`/api/v1/p/money-tracker-online/runs`) and falls back to a headless `cezar run` when the cockpit is
down; launchd calls it at 07:00, 12:00 and 17:00 on weekdays. Install (template in
`.ai/scripts/launchd/`):

```bash
sed -e "s|__REPO_ROOT__|$PWD|g" -e "s|__PATH__|$(dirname "$(command -v node)"):$(dirname "$(command -v gh)"):/usr/bin:/bin|g" \
  .ai/scripts/launchd/dev.money-tracker.housekeeping.plist > ~/Library/LaunchAgents/dev.money-tracker.housekeeping.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.money-tracker.housekeeping.plist
```

Remove with `launchctl bootout gui/$(id -u)/dev.money-tracker.housekeeping`. Log:
`.ai/cezar/tmp/housekeeping.log`. Run it by hand any time: `bash .ai/scripts/housekeeping.sh`.

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

4. Re-render the cockpit plist from the template (it pins 0.10.1),
   `launchctl bootout gui/$(id -u)/dev.cezar.cockpit`, `bootstrap` it again, and check
   `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/api/v1/p/money-tracker-online/runs`
   answers 200. On the host clone, `git config core.hooksPath` should be unset or `.husky/_`;
   either is fine, since the hook skips itself inside a run. An installed copy that still
   carries `HUSKY=0` can stay: cezar drops it before the agent starts.
5. The four command labels the `issue.labeled` automations react to
   (`ensure-label-taxonomy` in `.ai/trackers/github.md` carries them):

   ```bash
   gh label create groom          --color 5319e7 --description "Human trigger: re-run om-auto-manage-issues on this issue (Cezar automation)"
   gh label create autofix        --color 5319e7 --description "Human trigger: start om-auto-fix-issue on this issue (Cezar automation)"
   gh label create spec           --color 5319e7 --description "Human trigger: write a spec PR with om-auto-write-spec (Cezar automation)"
   gh label create review-threads --color 5319e7 --description "Human trigger: a review left unresolved threads; starts om-auto-fix-pr (Cezar automation)"
   gh label list --limit 100 | wc -l   # 31
   ```

6. `.ai/scripts/cez-automations.sh --dry-run`, then without the flag: `issue-groom`, `issue-regroom`,
   `issue-autofix`, `issue-spec`, `pr-autopilot` and `pr-review-threads` are created enabled. The
   script also lists any definition the cockpit still holds that the file no longer names — the
   retired `issue-opened` and `pr-opened` are deleted in the cockpit (Automations), by hand.
7. `.ai/scripts/cez-prompt-templates.sh --dry-run`, then without the flag: 37 templates replace
   cezar's five built-ins.
8. Install the housekeeping plist (above) and run `bash .ai/scripts/housekeeping.sh` once by hand.
9. Verify end to end: open a test issue with the Bug form (as a maintainer) → within two minutes an
   `issue-groom` run adds priority and risk and posts the Definition of Ready and implementation
   notes → add `autofix` → the run removes the label, claims with `in-progress`, opens a PR on
   `develop` with `Closes #n`, `bug`, `review` or `merge-queue`, `needs-qa` or `skip-qa`, priority
   and risk, a review from `om-auto-review-pr`, and ends with the `PR: #n` line in the cezar run.
   Nothing in its log mentions husky or lint-staged, and no duplicate issue appeared. Then open a
   PR by hand: `pr-autopilot` reviews it and does not merge.

## Local use

Every workflow's skill runs the same way in a local `claude` session, with the developer's `gh`:
`/om-auto-fix-issue <n>`, `/om-auto-manage-issues <n>`, `/om-auto-write-spec <n>`,
`/om-auto-implement-spec <spec>`, `/om-auto-review-pr <pr> [--autofix]`, `/om-pr-autopilot <pr>`,
`/om-review-prs`, `/om-merge-buddy`, `/om-close-fixed-issues`, `/om-brainstorm`,
`/om-spec-writing`, `/om-prepare-issue`, `/om-approve-merge-pr <pr>`. Hand-worked branches go
through `/om-check-and-commit` and `/om-open-pr`. The hooks are the project's, so nothing depends
on the host's user-level configuration.

A workflow can also run headless without the cockpit: `npx -y @open-mercato/cezar@0.10.1 run "21"
--workflow issue-groom --repo .`. It creates the same isolated worktree, cut from
`baseBranch`, not from the checkout you run it in, so a workflow or om config that only exists on a
feature branch is not in that worktree until the branch merges (the 2026-09-06 trial of the
grooming workflow on #21 pointed `baseBranch` at the branch for the run and reverted it). The run
uses your own `gh` identity, and `review` is terminal for it.
