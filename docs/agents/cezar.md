# Cezar on this repository

[open-mercato/cezar](https://github.com/open-mercato/cezar) is the only orchestrator of agent work
here (ADR 0013); the work itself is done by the `om-*` skills from
[open-mercato/skills](https://github.com/open-mercato/skills) (ADR 0017). Cezar runs on a developer
host, checks out one `cez/<id8>` worktree per run under `.ai/cezar/worktrees/`, polls GitHub for
the events in `docs/agents/cezar-automations.json`, and runs the workflow the event names. Every
label, comment and pull request comes from a skill acting through `.ai/trackers/github.md` under
the rules of `SDLC.md`.

## Install and configure

- Version: the `design4pro/cezar` fork, branch `design4pro` (upstream `v0.11.0` plus the commits
  below), cloned at `~/dev/cloudflare/cezar`, linked onto PATH with `npm run install-as-command`
  and started by the cockpit plist as `cezar serve`. Upstream is not a fallback, whether through
  `npx` or `npm i -g`: it runs without the fork's fixes and reports nothing. The
  project entry in `~/.cezar/config.json` points at the main checkout; the versioned part is
  `.ai/cezar/config.json` (`baseBranch: develop`, `worktreeRetention: 10`, `maxParallel: 2`,
  `reviewGate: false`, so a finished run settles straight to `done` rather than parking at
  `review` for a human to accept the diff; the gate only ever applied to non-autonomous runs,
  and partial automation is the point, `systemPrompt`, which is prepended to every run's prompt
  and is where the language contract lives, and `skillsRepos`, which is deliberately empty:
  listing a repository there hands `.claude/skills/` to the cockpit, which then replaces the
  vendored `om-*` tree. The collection's SHA lives in `skills-lock.json` alone)). Cezar's own
  `.ai/cezar/.gitignore` keeps run state, worktrees and its automations store out of git;
  `config.json` and `workflows/` are tracked. `defaultRunner` is deliberately absent from it: the
  backend is a fact about the host, so each host names its own in `~/.cezar/config.json`
  (`agentDefaults.runner`, set through the cockpit's workspace settings), and a repository key
  would override that on every host. A runner the host has not installed does not fail a run: the
  run sits at `running` with no agent process, `cancel` has nothing to stop, and every restart
  resumes it (issue-groom of #443 on a host without the Codex CLI, 2026-09-24).
- Fork commits: one per fix this pipeline needs and upstream has not shipped, each dropped once an
  upstream release carries it. The cockpit is one per host and shared with `planned.travel`, so the
  fork's checkout is the one copy both repositories run; `design4pro/cezar`'s
  `docs/host/README.md`, sections "The cockpit runs a fork, not npx" and "Taking an upstream
  release", is the runbook. Until kit 39
  these fixes were string patches on an npm install's `dist/`, applied by
  `.ai/scripts/cezar-host-patch.sh`; ADR 0021 retired the kit and that script is deleted.
  `CEZ_SKILLS_AUTO_UPDATE=0` is set in the cockpit plist on the host
  (`~/Library/LaunchAgents/dev.cezar.cockpit.plist`), which no template renders any more.
  - `issue.labeled` polls fail as soon as one recently updated issue has a comment or a
    cross-reference (open-mercato/cezar#914, fix in upstream PR #916, not in 0.11.0), so
    **Re-groom on request**, **Fix issues on the autofix label** and **Write a spec for feature issues** never fire. The fork cherry-picks #916.
  - On every cockpit start the skills coordinator runs `npx skills check <om-*> -p` in each project
    root, and that command re-adds the skills from upstream HEAD: the vendored
    `.claude/skills/om-*` directories become symlinks into an untracked `.agents/skills/`, which
    shows as hundreds of deleted files in `git status`. `skillsAutoUpdate: false` (kept in
    `~/.cezar/config.json`) gates only the update; the fork makes `CEZ_SKILLS_AUTO_UPDATE=0` skip
    the check too. Recovery: remove the symlinks, `git checkout -- .claude/skills`, delete `.agents/`.
  - Two runs forking their worktree in the same moment lose the `.git/config` lock: `git worktree
add -b` writes the new branch's upstream into the shared config, git's config lock has no
    retry, and the fork happens before cezar takes the repository-root lease, so `maxParallel`
    does not order it. Every loser dies with `worktree creation failed` before its workflow runs.
    The fork retries onto the reattach form, which writes no shared config.
  - A truncated label poll whose observations all sit in the overlap band returns the cursor it
    was handed, so the automation re-reads one window forever (planned.travel#351). The fork
    widens the budget of a poll that did not move its cursor and records the cursor it gave up at
    as `widenExhaustedAt`.
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
  under Settings → Personal access tokens). The full permission list, and what a run does for the
  operations the missing ones would serve, is "Token scopes the pipeline needs" below. The plist
  sets `GH_CONFIG_DIR` and cezar forwards it, so `gh` inside a run and `git push` over HTTPS (the
  global credential helper is `gh auth git-credential`, which reads the same variable) both act as
  the bot, while `~/.config/gh` and the developer's terminal stay the developer's. Commits carry
  `user.name design4pro-agent` and
  `user.email bot@design4.pro` from the host clone's local git config, which every worktree
  shares.
- Ports: the test environment (`.ai/scripts/test-env-up.sh`, the `om-prepare-test-env` contract)
  takes the first free port from **3011-3020**. 3010 is excluded on purpose: `vite.config.ts`
  binds it with `strictPort`, so it belongs to the developer's own dev server.

### Token scopes the pipeline needs

The permissions the bot's fine-grained PAT carries decide which tracker operations in
`.ai/trackers/github.md` are real and which silently degrade, so the next scope change is checked
against this list rather than against a run's behaviour. Which permission an operation needs is
fixed by GitHub's API and is the durable half of this section; which ones the token actually holds
is a snapshot, dated in the last column and re-checked with the probe below.

| Repository permission     | Operations it serves                                                              | Held 2026-09-10 |
| ------------------------- | --------------------------------------------------------------------------------- | --------------- |
| Metadata: read            | **repo-info**, **default-branch**, the ruleset read below (implicit on every PAT) | yes             |
| Contents: read/write      | `git push`                                                                        | yes             |
| Issues: read/write        | **get-issue**, **comment-issue**, the label and assignee guards                   | yes             |
| Pull requests: read/write | **create-pr**, **get-pr**, **get-pr-diff**, the review and review-thread ops      | yes             |
| Actions: read             | **list-runs**, **get-run**, **get-run-failed-logs**, **watch-run**                | yes             |
| Actions: write            | **rerun-failed**                                                                  | yes             |
| Commit statuses: read     | **get-pr-checks**' status half (`commits/{sha}/status`)                           | yes             |
| Artifact metadata: read   | nothing the pipeline calls                                                        | yes             |
| Administration: read      | — (refused by policy; see below, and it would buy nothing)                        | **yes** — drift |
| Workflows: read/write     | — (refused by policy: pushing under `.github/workflows/`)                         | **yes** — drift |

**There is no `Checks` permission to grant.** A fine-grained PAT's repository-permission picker
offers 34 entries and none of them is that one; `Checks` is a GitHub App permission. GitHub's
"Permissions required for fine-grained personal access tokens" reference documents 30 repository
permissions with no `Checks` section, and `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` does
not appear on that page at all — that endpoint is simply not reachable by this token type. So the
`403 Resource not accessible by personal access token` on the check-run half of the rollup is the
ceiling of the credential, not a missing grant, and no scope change lifts it. Verified in the token
UI and against the API reference on 2026-09-10; the finding is on #133. A classic PAT reads check
runs with `repo`, which is why the same command succeeds from a developer's shell and fails from the
cockpit — do not read one as evidence about the other.

The last two rows are drift, not policy. The Host identity bullet above refuses both, and the
token's own description says "No Workflows, no Administration", but the settings page for
`cezar-cockpit` on 2026-09-10 reads "Read access to administration, artifact metadata, commit
statuses, and metadata / Read and Write access to actions, code, issues, pull requests, and
workflows". Workflows: write lets a run push changes to the workflows that judge it, which is the
one thing this section exists to prevent. Administration: read buys nothing here, for the reason
under "Required checks" below. Both should come off at the next regeneration. Stated here, not
enforced: the skills read `.ai/trackers/github.md`, which is an ordinary file of this repository
since ADR 0021 - teaching them this is a pull request here.

Treat the last column as a reading, not a setting. It has now been wrong in both directions. While
#133 was being written, `commits/{sha}/status` answered 403 at 07:40Z and 200 at 07:57Z for the same
SHA and the same `gh` config, which is how the "Commit statuses" row came to say yes; and the four
rows this revision corrects had all been recorded from a run's behaviour rather than from the token
page, which is why three of them said "no" about permissions the token holds. Nothing in the
repository would have noticed; the probe below, and the settings page, are what turn the column back
into a fact.

The column keeps its 2026-09-10 date on purpose. The probe below was re-run on 2026-09-20 and the
three rows it can observe were unchanged — check runs refused, Commit statuses readable, Actions
readable — but a probe reads behaviour, and only the settings page can confirm or clear the two
drift rows. Re-date the column when someone reads that page, not when a run reads the API.

- **CI status.** The check-run view is the one that bites, and it is permanently out of reach:
  **get-pr-checks** answers `403 Resource not accessible by personal access token`; the GraphQL
  wording names `statusCheckRollup`, and once Commit statuses landed it narrowed to the per-context
  nodes underneath it — the rollup resolves, the check runs inside it do not. No permission fixes
  that, for the reason above. Commit statuses being
  readable buys nothing on its own here either, because nothing posts a commit status to this repository:
  every check comes from a workflow in `.github/workflows/`, so `commits/HEAD/status` reports zero
  statuses and **list-runs** for the head branch is the whole picture. A run reports CI from workflow
  runs and says in its report that the check-run view was unavailable — permanently, not pending a
  scope grant. Note what that costs: a check
  posted by an installed GitHub App rather than by a workflow would be invisible to a run, and this
  paragraph would stop being true without any signal that it had.
- **Required checks.** Classic branch protection stays unreadable:
  `branches/develop/protection/required_status_checks` answered 403 again on 2026-09-20, _with_ the
  drifted Administration: read in hand, so do not read that 403 as the missing-permission signal the
  rest of this section uses it for. It no longer decides anything, because that call reads _classic
  branch protection_ and this repository's gate is a repository **ruleset**, readable with Metadata
  alone: `gh api repos/{owner}/{repo}/rules/branches/{branch} --jq '.[].type'`. Since kit 47
  (`4b78a1c`) the descriptor reads exactly that first and classic protection only as an additive
  second source, falling back to "treat every reported check as required" only when **both** reads
  fail. So **get-required-checks** returns the real set here rather than a guess — which is what
  #133 asked for.

  **That set is no longer empty, and this section previously said it was.** On 2026-09-09 both
  branches resolved to `deletion`, `non_fast_forward`, `pull_request` and nothing else. On
  2026-09-23 `develop` (ruleset 22037820) and `main` (22037770) both have
  `required_status_checks`, no `merge_queue` rule and `Required approvals: 0`. They require the
  same four contexts, with `strict_required_status_checks_policy: false`:

  | Required context                       | Published by                       |
  | -------------------------------------- | ---------------------------------- |
  | `generated · typecheck · lint · build` | `.github/workflows/ci.yml`         |
  | `unit tests · coverage`                | `.github/workflows/ci.yml`         |
  | `e2e · merged report`                  | `.github/workflows/ci.yml`         |
  | `merge-gate`                           | `.github/workflows/merge-gate.yml` |

  The required contexts name the GitHub Actions integration (`integration_id` 15368). A status
  name and integration alone do not identify a trusted workflow file; required-workflow pinning
  and an adversarial workflow-edit test remain rollout prerequisites for automatic merging.
  **get-pr-checks** must read the current head's required check runs, including the custom
  `merge-gate` check run, rather than treating a skipped or missing result as a passing test.

  `ci.yml` now runs the browser legs on every pull request. The required `e2e · merged report`
  fails when those legs fail or are skipped. Artifact storage is advisory, but browser results
  are not. ADR 0020's 2026-09-23 amendment explains why deferring E2E to `merge_group` was
  unsafe without a live GitHub merge queue rule.

  **A sixth check exists and is deliberately not in that set.** `governance-gate`
  (`.github/workflows/governance-gate.yml`) reports on every pull request but requires none,
  because it was added after the rulesets were last written and making it required is a
  repository-configuration change a person takes on purpose. Read the table above as "what a merge
  waits for", not as "what runs": until someone adds the context to both rulesets, a red
  `governance-gate` is advice. Adding it means editing this table in the same change.

  The pipeline still holds a merge as well — the labels, the review verdict and the
  QA gate in `SDLC.md` — but it is no longer the only thing holding one, and prose elsewhere
  (this section included, before this revision) that credits the ruleset with enforcing nothing but
  pull-request-and-no-force-push predates the reading above. The `pull_request` rule still sets
  `required_approving_review_count: 0` on both branches, so the review gate remains the pipeline's,
  not GitHub's. It also sets `allowed_merge_methods: ["merge"]` on both — on `main` since
  2026-09-13 (ADR 0003, amendment 2026-09-13) and now on `develop` too — while `develop`'s merge
  queue is configured `merge_method: SQUASH`, `grouping_strategy: ALLGREEN`. Whether the merge
  tooling agrees with either is a merge-path question, not a CI one, and is tracked separately.
  Read the ruleset per repository and per branch rather than generalising:
  `design4pro/planned.travel` carries this same token and requires five contexts of its own on
  `develop` — near-identical but not equal (`lint · typecheck · build`, `unit tests`).

- **Re-running a job.** Actions: write is held as of 2026-09-10, so **rerun-failed** has the grant
  it needs; #133 recorded it as missing from a run's behaviour before the token page was read.
  Re-running is still bounded by judgement rather than by permission: a run that suspects
  infrastructure rather than a real failure may re-run the job once, and if the second attempt fails
  the same way it says so on the pull request, names the run id, and stops — it does not keep
  retrying and does not change code to chase a failure it could not disambiguate.

Probe, from the bot's `gh` config, once per repository — `planned.travel` carries the same token and
the same expectations, so run it there too. `HEAD` in a REST path is the default branch's tip, which
is what makes the first two lines stable to paste; the last two print the ruleset instead of a
verdict, because reading it is the point. The fifth is the one that catches the drift this section
has already been wrong about twice, and its output is a prompt to look rather than a verdict. 15368
is GitHub Actions. `unpinned` means the context is pinned to no app — `integration_id` is optional
in the ruleset API — which is ordinarily a plain Actions job, not an App check. Any other id is
pinned to some other App and is worth reading further: it is invisible to a run only if that App
publishes a _check run_, since one publishing a _commit status_ is readable with the Commit
statuses: read this token holds.

```bash
R=design4pro/money-tracker.online   # then repeat with design4pro/planned.travel
# Expected to FAIL: no fine-grained PAT can read check runs. A pass here means the config is
# authenticating as something other than the bot's fine-grained token.
GH_CONFIG_DIR=~/.config/gh-agent gh api "repos/$R/commits/HEAD/check-runs" >/dev/null 2>&1 \
  && echo "check runs: readable — NOT the fine-grained token" || echo "check runs: refused, as expected"
GH_CONFIG_DIR=~/.config/gh-agent gh api "repos/$R/commits/HEAD/status" >/dev/null 2>&1 \
  && echo "commit statuses: read ok" || echo "commit statuses: read MISSING"
GH_CONFIG_DIR=~/.config/gh-agent gh api "repos/$R/actions/runs?per_page=1" >/dev/null 2>&1 \
  && echo "actions: read ok" || echo "actions: read MISSING"
GH_CONFIG_DIR=~/.config/gh-agent gh api "repos/$R/rules/branches/develop" --jq '.[].type'
# The required contexts themselves, with the app each is pinned to. 15368 is GitHub Actions;
# `unpinned` is no app at all (the field is optional) and is ordinarily still a workflow. Any
# other id is pinned to another App - out of reach only if it publishes a check run rather than
# a commit status.
GH_CONFIG_DIR=~/.config/gh-agent gh api "repos/$R/rules/branches/develop" \
  --jq '.[] | select(.type=="required_status_checks")
        | .parameters.required_status_checks[]
        | "\(.integration_id // "unpinned")\t\(.context)"'
```

Both repositories are private, so an unauthenticated 200 cannot mask a missing permission. Were one
made public, the first three endpoints would answer without authorization and the probe would report
a scope it does not have.

Nothing is left to grant on this token. There is no `Checks` permission to add, and Actions: write
is already held; the one edit still owed under Settings → Personal access tokens on the
`design4pro-agent` account is a **removal** — Workflows and Administration off, re-approved once by
the organisation. The descriptor half has landed: teaching **get-required-checks** the rulesets
endpoint arrived here with kit 47 (`4b78a1c`, agent-kit#53), and `.ai/trackers/github.md` is this
repository's own file now, so nothing on the CI half of the pipeline is waiting on a scope grant or
on a kit sync any more. What remains is upkeep rather than a gap: the reading in this
section is a snapshot, and the ruleset has already changed under it once.

### The cockpit process

One cezar per host, not one per project. `cez serve` binds 127.0.0.1:4321 and answers
`GET /api/v1/p/<id>/runs` for every repo in `cezar projects`, so a second checkout wants
`cezar projects add <repo root>`, not a second cockpit (the second silently binds :4322 and both
write the same `.ai/cezar/` state). The `<id>` is `money-tracker-online`: cezar slugs it from the
checkout's directory basename. Every script here defaults to it and takes `CEZ_PROJECT` as the
override; `GET /api/v1/projects` is the authority when a host disagrees.

The cockpit is host-wide state, so its plist is not this repository's to own: the template and the
cutover runbook live in `design4pro/cezar` (`host/launchd/dev.cezar.cockpit.plist`,
`docs/host/README.md`). This repository keeps only its own housekeeping plist, below. The copy that
used to sit here was invisible to `planned.travel`, which had none at all, and one copy for the host
is still the answer - it moved with the rest of the host layer when agent-kit was retired
(ADR 0021).

`KeepAlive` means `bootout` is how you stop the service; `kickstart -k
gui/$(id -u)/dev.cezar.cockpit` is the restart after a version bump or an edit to the plist. Once
it is installed, stop running bare `cezar` in a repo. Log: `~/Library/Logs/cezar-cockpit.log`.

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
- `guard-generated.sh` (Edit, Write) refuses the generated files — `src/routeTree.gen.ts`,
  `drizzle/`, `worker-configuration.d.ts` — for everyone, in every mode, and in an agent run also
  refuses any write that walks through `..` or lands outside the worktree. That confinement has a
  real incident behind it: a pr-autopilot run once rewrote eight files in a sibling checkout a
  human was working in, and nothing downstream could tell.

  It used to refuse a third set — `.github/`, `.claude/`, `.husky/`, `.ai/cezar/`,
  `.ai/agentic.config.json`, `.ai/trackers/`, `.ai/browsers/`, `.ai/skills/`, `.ai/scripts/`,
  `scripts/ci/`, `.npmrc`, `pnpm-workspace.yaml`, `docs/agents/reference.md` and
  `docs/agents/out-of-scope.md` — in a cezar run too, with an exception for a file the branch
  already changed. **Not any more** (ADR 0021): a cezar run edits its own skills, workflows and
  gate like any other change here, and the review of its branch is what judges that. The
  `in_branch_diff` exception went with it, having existed only to soften that block.

  Under `GITHUB_ACTIONS` that third set is still refused, without exception. There the diff being
  read is the pull request author's, so "this branch already changes it" is the author's own claim,
  and the review job holds a write token while reading it.

Agent steps carry no `bashAllowlist` (ADR 0017): the tracker descriptor is shell functions and
`jq`, and a prefix allowlist would drop label mutations silently. The hooks in `.claude/hooks/`,
the PAT scopes, one worktree per run and `maxParallel: 2` are the gate. `.claude/settings.json`
carries no permission rules; it is hooks-only, and the rules a `deny` list used to hold moved into
`git-guardrails.sh` and `guard-read.sh`, which see the whole command rather than a prefix.
`.claude/hooks/__tests__/hooks.test.ts` (vitest project `tooling`) holds the hooks' contract.

## Workflows (`.ai/cezar/workflows/`)

Most workflows are a setup step (`HUSKY=0 pnpm install --frozen-lockfile --prefer-offline && pnpm
generate-routes`) and one agent step whose prompt is the skill as a slash command
(`/om-… {{task}}`). `allowedTools` is the full set for skills that write code and drops
`Edit`/`Write` for the ones that must not.

**Two things that sentence used to claim, and should not.** It said the tree is "the same nine
workflows as `planned.travel`": there are fifteen here, and the six that arrived with the `afk-*`
intake ladder have no counterpart there. And it said `/om-…` rather than `skill:` because the
slash form "would load the thin `.ai/skills/` override alone" — reading cezar 0.11.1 says
otherwise. `expandRegistrySlashSkillText` resolves `/name` through the same registry `skill:` uses
and injects the same single winning body (`packages/cezar/src/workflows/run.ts`), and local-first
precedence means the `.ai/skills/` override wins either way. The slash form is the house
convention, not a fix. What actually keeps the chain working is that every `.ai/skills/om-*`
override names its installed `.claude/skills/<name>/SKILL.md` in its opening line and every
workflow grants `Read`, so the agent can follow the pointer; `.ai/scripts/__tests__/agent-layer-parity.test.mjs`
asserts exactly that.

`backlog` deliberately has no bootstrap step: it is plain node plus `gh`, and a report that is
cheap to start is one a human actually starts. The four `afk-*` workflows have none either, but
not deliberately — see the note under the table.

| Workflow              | Agent step                                                               | Started by                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `issue-groom`         | `/om-auto-manage-issues {{task}} --prep-impl`                            | automation **Groom new issues** (`issue.opened`), **Re-groom on request** (label `groom`)                                                |
| `issue-autofix`       | `/om-auto-fix-issue {{task}}`                                            | automation **Fix issues on the autofix label** (label `autofix`)                                                                         |
| `spec`                | `/om-auto-write-spec {{task}}`                                           | automation **Write a spec for feature issues** (label `spec` on a `feature`)                                                             |
| `implement-spec`      | `/om-auto-implement-spec {{task}}`                                       | a human, from the cockpit, after the spec PR merged - or `autofix` on the FR issue, which reaches the same skill through `issue-autofix` |
| `pr-autopilot`        | `/om-pr-autopilot {{task}}` (no `--allow-merge`)                         | automation **Autopilot new pull requests** (`pull_request.opened` by a human maintainer)                                                 |
| `pr-review`           | `/om-auto-review-pr {{task}} --autofix`                                  | a human, from the cockpit, on a PR number                                                                                                |
| `pr-fix`              | `/om-auto-fix-pr {{task}}`                                               | manual PR repair                                                                                                                         |
| `housekeeping`        | `/om-review-prs`, `/om-merge-buddy`, `/om-close-fixed-issues --limit 50` | launchd `dev.money-tracker.housekeeping` → `.ai/scripts/housekeeping.sh`, weekdays 07:00/12:00/17:00, or a human                         |
| `brainstorm`          | `/om-brainstorm {{task}}`, **Autonomous off**                            | a human, from the cockpit, with the idea as the task                                                                                     |
| `backlog`             | `/backlog {{task}}`, no bootstrap, **Worktree off**                      | a human, from the cockpit, or `cezar run "<filter>" --workflow backlog`                                                                  |
| `implement-ticket`    | `/om-fix {{task}}` → gate → `/om-open-pr` → `/om-auto-review-pr`         | automation **Implement ready-for-agent issues** (label `ready-for-agent`, and `risk-low`)                                                |
| `triage`              | `/afk-triage {{task}}`                                                   | automation **Triage new issues** (label `needs-triage`)                                                                                  |
| `spec-to-tickets`     | `/afk-to-tickets {{task}}`                                               | automation **Spec to tickets**, weekdays 07:00                                                                                           |
| `architecture-review` | `/afk-architecture-review {{task}}`                                      | automation **Weekly architecture review**, Mondays 06:00                                                                                 |
| `lessons`             | `/afk-lessons {{task}}`                                                  | automation **Weekly lessons**, Fridays 16:00                                                                                             |

The last five rows were shaped unlike the ten above them until 2026-09-20, and it was a defect
rather than a style. Four were the three-line `skills:` shorthand, so they carried no bootstrap
step and cezar's `DEFAULT_ALLOWED_TOOLS` — `[Read, Edit, Write, Grep, Glob, Bash]`,
which both over-granted (`triage` and `architecture-review` are documented read-only) and
under-granted (`Skill` and `TodoWrite` are absent, so `afk-lessons` §1 and §4 could not reach
`om-pipeline-retro` or `om-open-pr`). `implement-ticket` inlined all seven validation commands
verbatim in its gate step, which was the one place in the repository that copied
`validation.commands` instead of reading it.

All five now carry a bootstrap step and an explicit grant: `triage`,
`spec-to-tickets` and `architecture-review` read-only (`[Read, Grep, Glob, Bash, Skill,
TodoWrite]`), `lessons` and `implement-ticket` with `Edit` and `Write` because they write. The
gate step runs `node scripts/ci/run-validation.mjs`, which reads `validation.commands` — so the
list lives in one file again, and `.ai/scripts/__tests__/cezar-workflows.test.mjs` fails if any
workflow copies a command out of it. The same test fails a workflow that prompts without a grant,
or one that neither bootstraps nor says in a comment why it does not.

**No workflow names a model, and the test enforces that.** Until 2026-09-22 most agent steps
carried a `model:` — `opus` on the ones that reason, `sonnet` on the ones that execute. A step
`model:` wins over the model the run was started with, and it is a claim about one backend: a
Claude alias handed to a codex run is a model the API refuses every request on. Eighteen local
codex runs did nothing at all, seventeen of them recorded `done`, because the refusal arrived on a
channel the runner did not read. The model now belongs to the run: the cockpit composer picks it
for a run a human starts, and an automation run uses the backend CLI's own default unless the
automation sets `task.model` in `docs/agents/cezar-automations.json`.
`.ai/scripts/__tests__/cezar-workflows.test.mjs` fails any agent step that pins one again.

The task text an automation sends is the issue or PR number alone (`{{github.number}}`); a second
token would read as a brief to `om-auto-fix-issue`, which is why the cockpit's pre-filled
`Fix GitHub issue #<n>: <title>` is safe only because the `om-auto-fix-issue` override treats a
text naming exactly one issue of this repository as an issue reference. From the cockpit type the
same: a number, a spec path, or for `brainstorm` the idea.

**Starting a run.** GitHub tab → issue → "Hand this to the agent" → workflow → the task box.
Implementation also has label triggers. Two ladders start code-writing work, and only the first is
a human's lever:

- **The three command labels** — `groom`, `autofix` and `spec` on an issue.
  No skill adds any of them (the `.ai/skills/` overrides say so), so no run can start another
  through this route.
- **The intake ladder** — `needs-triage` starts `triage`, and `ready-for-agent` starts
  `implement-ticket`. These the pipeline does set for itself: a groom that ends
  `READY_STATUS=ready` applies `needs-triage` when the issue carries no intake label yet, and
  `afk-triage` consumes that label and applies one of `needs-info` / `ready-for-agent` /
  `ready-for-human`. That is the whole point of the ladder, and it is why a filed issue reaches an
  open PR with nobody in it. What keeps it bounded is the filter rather than the label discipline:
  the implementing automation requires `risk-low` and excludes `risk-high` and `security`, and
  `afk-triage` routes the last two to `ready-for-human` before either could matter. Grooming never
  applies `ready-for-agent` itself — it does not check that the issue is real, still unfixed, or
  already covered by an open PR, and triage is the step that does.

This paragraph used to end "the command labels are the only things that start code-writing
work". That has not been true since `ready-for-agent` was wired to `implement-ticket` (ADR 0017,
amendment 2026-09-17).

**Merge and after.** `om-merge-buddy` reports what is mergeable. For a non-draft `develop` PR
without `risk-high` or `needs-qa`, Cezar completes its review and the trusted controller may
enable auto-merge after the required checks pass, once `AUTO_MERGE_ENABLED=true`. Until that
rollout, a maintainer merges manually. `risk-high`, `needs-qa` and `develop` → `main` always
merge manually after their respective human decisions (`SDLC.md`). The live rulesets have no
GitHub merge queue rule; the `merge-queue` label is a process state only. After a merge,
`/om-close-fixed-issues` closes what the merge did not: Cezar has no `pull_request.merged`
event, and `develop` is not the default branch, so nothing closes natively. Housekeeping runs
three times a day. Only a human sets `qa-approved`: the blind pair is
`node scripts/visual/capture.mjs` (ADR 0016).

## Automations (`docs/agents/cezar-automations.json`)

Registered with the running cockpit by `.ai/scripts/cez-automations.sh` (`--dry-run` first;
idempotent: update in place or create enabled; it lists definitions the cockpit holds that the
file no longer names, and `--prune` deletes them except an enabled one, so the file is the whole
truth). Ten definitions, in three groups.

**The command-label five:** **Groom new issues** on `issue.opened` with `authors` naming the human
maintainers; **Re-groom on request**, **Fix issues on the autofix label**, **Write a spec for
feature issues** on `issue.labeled` with `changedLabels` `groom` / `autofix` / `spec`;
**Autopilot new pull requests** on `pull_request.opened`, again with `authors`.

**The intake pair:** **Triage new issues** on `changedLabels` `needs-triage`, and **Implement
ready-for-agent issues** on `changedLabels` `ready-for-agent`, the latter excluding `risk-high`
and `security`.

**The three schedules:** **Spec to tickets** (weekdays 07:00), **Weekly architecture review**
(Mondays 06:00) and **Weekly lessons** (Fridays 16:00).

Every trigger is gated on who can produce it: the open events by author, the label events because
only a collaborator or an Actions token can set a label. This matters because the agent step holds Bash with no
allowlist and the issue body is its prompt: an issue anyone on GitHub can open must not start a run
by itself, so an external report is groomed when a maintainer adds `groom`. The skill that reacts
removes its own command label as its first tracker mutation, so a label still present means nobody
picked the issue up.

Agent PRs (authored by `design4pro-agent`, already reviewed inside their own chain) and Dependabot
never enter the autopilot, and the pipeline labels stay excluded because the poller re-checks labels
on every poll: while the cockpit still ran under the maintainer's `gh`, the first `om-fix-issue` run
got a second review the moment its `in-progress` lock lifted. Every filter excludes `in-progress`;
`lookbackDays: 3` and `maxRecords` 5-10 bound a mistaken burst to a handful of runs. The poller
runs unless the service env sets `CEZ_AUTOMATIONS=0` (the default since 0.11.0; the plist's
explicit `1` changes nothing), and a 409 from the API says it is off.

A review or autopilot run checks out the PR's head, hooks included: a branch cut before the om
cutover (`f2a258e`) carries the old `git-guardrails.sh`, which blocks every GitHub write in agent
mode, and the run ends in a question nobody answers (PR #67, 2026-09-07). Merge `develop` into such
a branch before opening the PR.

## Prompt templates (`docs/agents/cezar-prompt-templates.json`)

Installed into the cockpit by `.ai/scripts/cez-prompt-templates.sh` (`--dry-run` lists what it would
write). One template per `om-*` skill, 38 of them for the collection's 42; `om-backlog`,
`om-mockup-prototype`, `om-setup-discovery-pipeline` and `om-synthetic-users` have none yet. Each
carries the task text with its argument placeholder, the flags, and the preconditions the skill's
`SKILL.md` and its `.ai/skills/` override state, phrased as directives because the text is sent as
the task. They replace cezar's five generic built-ins. The installer `PUT`s `promptTemplates` to
`/api/v1/p/money-tracker-online/ui-state`, which merges shallowly at the top level, so it rewrites
that one array and leaves every other preference alone; the store is `.ai/cezar/ui-state.json`,
which is gitignored because it also accumulates per-developer state (`skillUsage`, `lastTask`,
`appearance`). Edit the tracked JSON and re-run the script — never the ui-state file by hand.

Cezar's normalizer truncates and drops silently, so the script checks the caps first: at most 50
templates, `label` 80 characters, `text` 2000, ids unique and matching an installed skill — which
`.claude/skills/om-*` carries in the checkout, so that last check needs no install step.

A template whose `skills` array names the skill selected in the composer is applied automatically,
but only while the composer is still pristine. That is why only the 19 skills taking a free-text
brief or no argument carry `skills`; the 19 that take an issue number, a PR number, a spec path or
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

4. Re-render the cockpit plist from the template (`__CEZAR__` is the fork's linked `cezar`),
   `launchctl bootout gui/$(id -u)/dev.cezar.cockpit`, `bootstrap` it again, and check
   `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/api/v1/p/money-tracker-online/runs`
   answers 200. On the host clone, `git config core.hooksPath` should be unset or `.husky/_`;
   either is fine, since the hook skips itself inside a run. An installed copy that still
   carries `HUSKY=0` can stay: cezar drops it before the agent starts.
5. The three command labels the `issue.labeled` automations react to
   (`ensure-label-taxonomy` in `.ai/trackers/github.md` carries them):

   ```bash
   gh label create groom          --color 5319e7 --description "Human trigger: re-run om-auto-manage-issues on this issue (Cezar automation)"
   gh label create autofix        --color 5319e7 --description "Human trigger: start om-auto-fix-issue on this issue (Cezar automation)"
   gh label create spec           --color 5319e7 --description "Human trigger: write a spec PR with om-auto-write-spec (Cezar automation)"
   gh label list --limit 100 | wc -l   # 31
   ```

6. `.ai/scripts/cez-automations.sh --dry-run`, then without the flag: **Groom new issues**, **Re-groom on request**,
   **Fix issues on the autofix label**, **Write a spec for feature issues** and **Autopilot new pull requests** are created enabled. The
   script also lists any definition the cockpit still holds that the file no longer names. To
   remove one, disable it in the cockpit (Automations), then run `--dry-run --prune` and
   `--prune`: the script refuses to delete an enabled stray.
7. `.ai/scripts/cez-prompt-templates.sh --dry-run`, then without the flag: 38 templates replace
   cezar's five built-ins.
8. Install the housekeeping plist (above) and run `bash .ai/scripts/housekeeping.sh` once by hand.
9. Verify end to end: open a test issue with the Bug form (as a maintainer) → within two minutes an
   **Groom new issues** run adds priority and risk and posts the Definition of Ready and implementation
   notes → add `autofix` → the run removes the label, claims with `in-progress`, opens a PR on
   `develop` with `Closes #n`, `bug`, `review` or `merge-queue`, `needs-qa` or `skip-qa`, priority
   and risk, a review from `om-auto-review-pr`, and ends with the `PR: #n` line in the cezar run.
   Nothing in its log mentions husky or lint-staged, and no duplicate issue appeared. Then open a
   PR by hand: **Autopilot new pull requests** reviews it and does not merge.

## Local use

Every workflow's skill runs the same way in a local `claude` session, with the developer's `gh`:
`/om-auto-fix-issue <n>`, `/om-auto-manage-issues <n>`, `/om-auto-write-spec <n>`,
`/om-auto-implement-spec <spec>`, `/om-auto-review-pr <pr> [--autofix]`, `/om-pr-autopilot <pr>`,
`/om-review-prs`, `/om-merge-buddy`, `/om-close-fixed-issues`, `/om-brainstorm`,
`/om-spec-writing`, `/om-prepare-issue`, `/om-approve-merge-pr <pr>`. Hand-worked branches go
through `/om-check-and-commit` and `/om-open-pr`. The hooks are the project's, so nothing depends
on the host's user-level configuration.

A workflow can also run headless without the cockpit: `cezar run "21" --workflow issue-groom
--repo .` (the fork's linked `cezar`; there is no npx form, since upstream lacks the fork's
fixes). It creates the same isolated worktree, cut from
`baseBranch`, not from the checkout you run it in, so a workflow or om config that only exists on a
feature branch is not in that worktree until the branch merges (the 2026-09-06 trial of the
grooming workflow on #21 pointed `baseBranch` at the branch for the run and reverted it). The run
uses your own `gh` identity, and `review` is terminal for it.
