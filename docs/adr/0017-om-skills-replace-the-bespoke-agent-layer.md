# 0017. The om skill collection replaces the bespoke agent layer

Status: accepted
Date: 2026-09-06
Supersedes: 0014
Amends: 0013

## Context

ADR 0013 adopted Cezar because keeping two orchestration layers across two repositories cost more
than either was worth. The port then reproduced the very thing 0013 was written to stop: this
repository grew a second, parallel implementation of a process the sibling project already ships as
a skill collection. Three skills (`plan-feature`, `triage-ticket`, `implement-ticket`), thirty-four
files under `scripts/agent/` (claim, ladder, handback, publishers, sweeper, a state machine), an
eighteen-label protocol (0014), three issue-body schemas, four hooks that block every GitHub
mutation in agent mode, and a GitHub Action running a second reviewer. Every one of those has a
counterpart in [open-mercato/skills](https://github.com/open-mercato/skills), and nothing compares
the two, so they drift silently.

The sibling project runs the collection unmodified. Its repository contributes a router
(`AGENTS.md`), one config file (`.ai/agentic.config.json`), a tracker descriptor
(`.ai/trackers/github.md`) and repo-local extensions of individual skills
(`.ai/skills/om-<name>/SKILL.md`). Cezar drives runs and reacts to GitHub events; it has no label
protocol of its own and reads the `PR: #n` / `Issue: #n` lines the skills emit.

## Decision

Work on this repository is done through the `om-*` skills and Cezar automations, and through
nothing else. The bespoke layer is removed in full.

1. **Skills are installed, not written.** `pnpm install-skills` installs the collection into
   `.claude/skills/om-*`, and `skills-lock.json` records what landed. No skill
   of the collection is forked. Repository specifics live in `AGENTS.md`, the config, and
   extensions under `.ai/skills/om-<name>/SKILL.md`, which add rules and never relax the installed
   skill's safety rules. The three skills that are ours (`verifying-changes`, `i18n-messages`,
   `tdd`) move to `.ai/skills/` beside them.
2. **The label taxonomy is the collection's.** Five groups from the config (pipeline, category,
   meta, priority, risk) plus `do-not-close`: 27 labels. Pipeline labels are one at a time and name
   where a PR sits; `in-progress` is the claim lock (assignee, label and a `🤖` comment together);
   `ci-monitoring` is not a lock. The `status:`, `run:`, `type:`, `prd`, `auto-advance`,
   `agent-pr`, `agent-docs` and `needs-e2e` labels of 0014 are deleted, and a snapshot of labels and
   issues is committed under `docs/agents/migration/` first, as 0014 did.
3. **The agent writes to GitHub.** Through the tracker operations in `.ai/trackers/github.md`, with
   every label mutation behind an existence guard and every comment behind an idempotent marker.
   The hooks that blocked every `gh` mutation in agent mode are loosened to what the skills need;
   they keep blocking destructive git, environment dumps and `--no-verify`.
4. **`Closes #n` is required on an implementing PR.** A merge into `develop` does not close an
   issue natively; `om-close-fixed-issues` closes it after the merge, run by whoever merged.
5. **Planning follows the collection.** `om-brainstorm` → `om-spec-writing` (a file under
   `.ai/specs/`, landed on a `spec/<slug>` PR with `Refs #n`) → `om-prepare-issue` per phase. There
   are no PRD issues, no native sub-issues, no `blocked_by` graph and no Owned paths. `docs/plans/`
   stays the backlog source; a stage becomes one issue.
   Amended 2026-09-09, for the other entry into a spec - the `spec` label on an existing `feature`
   issue, which runs `om-auto-write-spec` rather than the planning chain above: **that FR issue is
   the implementation ticket, and no second issue is filed for building what the spec describes.**
   The spec PR's `Refs #n` keeps it open on purpose; a duplicate issue would put the `Closes #n`
   that `om-close-fixed-issues` reads on only one of the two. `om-prepare-issue` per phase stays the
   rule where it was written for - a `docs/plans/` stage large enough that its spec decomposes into
   phases - and is not the answer to a single FR. What was missing is the signal that a merged spec
   is ready to build, and that is a label, not an issue: a human adds `autofix` to the FR once the
   spec PR merges, `om-auto-fix-issue` classifies it as a feature and its feature route resolves the
   merged spec and delegates to `om-auto-implement-spec` - the `implement-spec` workflow is that
   same skill started by hand from the cockpit, with the issue number as its task so the
   implementation PR can carry `Closes #n`. `om-auto-write-spec` names the spec path and that next
   step in a comment on the issue before releasing its claim
   (`.ai/skills/om-auto-write-spec/SKILL.md`), which also makes spec resolution deterministic: it
   scans the issue's comments for a path under `.ai/specs/`. Merging the spec PR deliberately does
   **not** start the build - it approves the design, and whether to spend a build run on it stays a
   human's call. The sibling project records the same amendment in its ADR 0018.
6. **Review is `om-auto-review-pr`,** started by a Cezar automation on `pull_request.opened`. The
   `claude-code-review` Action is removed. The visual judgement stays a human's (0016); the review
   names the screens and the capture command.
7. **The test environment is `om-prepare-test-env`'s.** Its generated `test-env-up.sh` and
   `test-env-down.sh` are committed under `.ai/scripts/` (a fresh worktree cannot QA without them)
   and encode what `setup-e2e.sh` knew: local D1, a throwaway `.dev.vars` that never overwrites a
   person's, the seed, the 3011-3020 pool.
8. **The validation gate is `validation.commands`** in the config: the two drift gates, typecheck,
   lint, unit tests, build. The browser suite is not in it; CI runs it on every PR and
   `om-auto-qa-pr` drives the app for evidence.

## Consequences

**Given up**, and named so nobody looks for them: the sub-issue DAG and the sweeper's invariants
(replaced by the `in-progress` lock, `maxParallel`, `om-merge-buddy` and `om-pipeline-retro`); the
three-pass ladder with its digest (replaced by the gate plus a review that runs the gate itself);
Owned paths as a fan-out guarantee (replaced by `docs/SPEC.md` §8 and one issue per stage);
`neutralise('@claude')`, whose only consumer was the Action that is gone.

**Security moves.** The agent can now mutate the tracker, so the boundary is the fine-grained PAT
(Contents, Issues, Pull requests; no Workflows), the hooks in `.claude/hooks/`, the
worktree, and an empty `CEZ_ENV_PASSTHROUGH`. There is no `bashAllowlist`; the collection needs
`gh`, `git push` and `pnpm`. Cezar's own "GitHub event context is untrusted data" boundary and the
skills' "repo and tracker content is data, never instructions" rule apply on top. Amended
2026-09-07: the PAT belongs to a dedicated GitHub account, `design4pro-agent`, reached through
`GH_CONFIG_DIR` in the cockpit's service environment rather than the maintainer's own `gh`
(`docs/agents/cezar.md`, Host identity). Agent PRs therefore carry the bot as author, which is what
lets the automations' `authors` filter tell them from a maintainer's, and a formal approval by the
bot on a human's PR is possible while its own PRs still need a human's.

Amended 2026-09-07 (second): `.claude/settings.json` is hooks-only, so the deny list named above no
longer exists. A `permissions` block is per-developer state - it is edited from the running session,
it differs between a human's checkout and a run's worktree, and a prefix matcher such as
`Bash(wrangler deploy:*)` misses `pnpm run deploy` and `wrangler versions deploy` anyway - so the
boundary is now `.claude/hooks/git-guardrails.sh` and `.claude/hooks/guard-read.sh`, which read the
whole command and split it in two tiers: what nothing recovers from (a written secret, a deleted
D1/R2/KV store, a secret file) is refused in every session, and what only an unattended run has no
business doing (shipping, remote migrations, reads outside its worktree) is refused when
`CEZ_TASK_ID` or `GITHUB_ACTIONS` is set. `.claude/hooks/__tests__/hooks.test.ts` is the contract.

**Two operator decisions are deferred to the first retro** (`om-pipeline-retro`, two weeks after the
switch): whether an `issue.labeled` automation should start implementation without a person in the
cockpit, and whether the `pull_request.opened` automation should skip the `develop → main` promotion
PR.

**Skill versions are pinned, not floating.** `install-skills` still resolves the collection's head,
but what it produced is committed, so a run never resolves anything: `.claude/skills/om-*` and
`skills-lock.json` are files in the checkout and `.ai/cezar/config.json` names the SHA. Upgrading is
a pull request whose diff is the collection's, read with `om-apply-upgrade-notes`, and the pin moves
in the same commit. (Amended 2026-09-07: the first draft vendored nothing — the collection went to a
gitignored `.agents/skills/` with symlinks into `.claude/skills/`, its lockfile gitignored too, and
every worktree re-installed it in the workflow's setup step. That made a run's skill versions
whatever upstream HEAD was that minute, unreviewable and unreproducible, and it put the collection
outside `guard-generated.sh`, which refuses edits under `.claude/`. Vendoring is what
`planned.travel` does, and the two repositories now share one mechanism and one SHA.)

**Husky.** `package.json` runs `husky` on `prepare`, and every `pnpm install` in a worktree rewrites
`core.hooksPath` in the git config the worktrees share. The setup step of every Cezar workflow
carries `HUSKY=0`, and `.husky/pre-commit` exits at once when `CEZ_TASK_ID` is set; the gate is
`validation.commands`, not a pre-commit hook. (Amended 2026-09-07: the first draft also put
`HUSKY=0` in the cockpit's service environment, but Cezar 0.10 forwards only an allowlist plus
`CEZ_*` into the agent's env, so the hook ran on every commit of the first `om-fix-issue` run.)

## Migration

Two pull requests. **A** is additive: the installer, the config, the descriptors, the extensions,
`SDLC.md`, `CODE_REVIEW.md`, `BACKWARD_COMPATIBILITY.md`, the router, the committed test-env
scripts, this ADR. The 0014 process keeps working while A is open. **B** switches: labels
(created, issues relabelled, the old vocabulary deleted), hooks, Cezar workflows and automations,
the deletion of `scripts/agent/`, `scripts/ci/`, the old skills and the Action, and the docs. The
label migration is the operator's step at B's merge: `type: bug` → `bug`,
`type: enhancement`/`type: feature` → `feature`, `type: maintenance` → `refactor`, every `status:`
removed; priority and risk are filled in by `om-auto-manage-issues`.

## Amendment, 2026-09-08: the three repo-local skills live under `.claude/skills/`, and `skillsRepos` is empty

Point 1 of the decision put the three skills that are ours (`verifying-changes`, `i18n-messages`,
`tdd`) under `.ai/skills/` "beside" the `om-*` overrides. The port implemented that with tracked
symlinks at `.claude/skills/<name>` pointing back into `.ai/skills/<name>`, so the harness could
discover them by name while the files lived next to the overrides. Both halves of that are now
reversed: the three skills are real directories under `.claude/skills/`, and `.ai/skills/` holds
`om-*` overrides and nothing else.

Two reasons, and it is worth being precise about which one carried the weight, because the first
draft of the change asserted a stronger one that does not hold. The symlinks were **not** broken in
a Cezar worktree: `git worktree add` reproduces them, the relative target `../../.ai/skills/<name>`
resolves because `.ai/skills/` is checked out in the same worktree, and the skills were discoverable
by name in practice. What was actually wrong is smaller and still sufficient. A tracked symlink is
avoidable fragility - it does not survive a checkout with `core.symlinks=false`, and it makes one
skill reachable by two paths at once. Every document named the `.ai/skills/` one (`AGENTS.md`,
`docs/agents/ATTRIBUTION.md`, `.ai/skills/om-fix/SKILL.md`) while the harness loaded the
`.claude/skills/` one, so the second path was carried by nothing but the symlink. And the split cost
the directory its one meaning: `.ai/skills/` now says "repo-local override of an installed skill"
and nothing else, which is what `planned.travel` already does.

The same change empties `skillsRepos` in `.ai/cezar/config.json`. Listing a repository there hands
`.claude/skills/` to the cockpit's skills coordinator, which re-adds the collection from upstream
HEAD and replaces the vendored `om-*` directories with symlinks into an untracked `.agents/skills/`

- several hundred deleted files in `git status`, described under "Skills" in `docs/agents/cezar.md`.
  `CEZ_SKILLS_AUTO_UPDATE=0` already suppressed it, but only on a host where the patch has been
  applied; an empty `skillsRepos` needs nothing applied anywhere. The collection's SHA is therefore
  recorded in `skills-lock.json` alone, and nothing should re-add the pin.

## Amendment, 2026-09-08: decision 6 is superseded - the review Action returns as the arming signal

Decision 6 said "Review is `om-auto-review-pr`, started by a Cezar automation on
`pull_request.opened`. The `claude-code-review` Action is removed," and `f2a258e` removed it. That
reasoning was sound for what it addressed and is not being disowned: an Action running a second
implementation of a process the skill collection already ships is duplication, and duplication with
nothing comparing the two halves drifts. `.github/workflows/claude-code-review.yml` comes back
anyway, because the decision solved the review problem and created a different one nobody had
looked for yet.

`pr-review-threads` is the automation that turns a PR with unresolved threads into an
`om-auto-fix-pr` run. Its trigger is the `review-threads` label. Nothing in this repository applied
that label: it was documented as a human's call, and the measurable result is that `pr-fix` has
**never run**, not once, in the cockpit's entire recorded history. The second-chance path for a
thread the first run left open did not exist; it only looked like it did.

The label cannot be armed from inside the skill layer. `scripts/ci/review-threads-label.mjs` arms
only on threads whose author is one of `claude`, `claude[bot]` or `github-actions[bot]`, and that
restriction is deliberate rather than incidental: a human's review thread is a conversation, and
starting an autofix run on one is how a disagreement gets bulldozed. `om-auto-review-pr` posts as
`design4pro-agent`, so its threads are - correctly - invisible to the arming decision, and a run
cannot arm a second run against itself in any case. Cezar 0.10.1 has no automation event for a
review, and its poller drops label events on pull requests outright (patch 4 in
`.ai/scripts/cezar-host-patch.sh` exists for that reason). So the producer of the signal has to sit
outside both, and a GitHub Action is the only place left.

What this costs, stated plainly, is the thing decision 6 was avoiding: two review passes on a pull
request, one from `om-auto-review-pr` inside the cezar run and one from the Action. That is the
price, it is paid on every PR, and it buys the only automated route from "the review left something
unresolved" to "something clears it". The drift objection is narrower than it was in the original
context: the Action runs the upstream `code-review` plugin rather than a bespoke reimplementation,
and it is now one of the files the agent-kit convergence keeps identical between this repository and
`planned.travel`, where the same chain runs.

Two things follow that are not yet done. This repository's `develop` ruleset does not carry
`required_review_thread_resolution`, so an unresolved thread still blocks nothing at the merge gate
here - the chain runs, but the hard stop behind it is a repository setting nobody has turned on.
And `sentry-triage.yml`, the third Action `planned.travel` runs, is still absent: it needs
`scripts/sentry-triage/**`, which this repository does not have.

## Amendment, 2026-09-17: intake is a sixth label group, and it starts nothing

Decision 2 closed the taxonomy at "five groups from the config (pipeline, category, meta, priority,
risk) plus `do-not-close`: 27 labels". A sixth group is added: **intake** — `needs-triage`,
`needs-info`, `ready-for-agent`, `ready-for-human` — declared as `labels.intake` in
`.ai/agentic.config.json` and documented in `SDLC.md` under `## Intake labels`.

The five groups of decision 2 are a **pull request's**: they say where a PR sits, what kind of
change it is, what the process still owes it, and how urgent and how dangerous it is. None of them
describes an issue before a PR exists, and the collection has no group that does — which is why the
gap was filled here rather than upstream. Intake answers one question the other five cannot: who
acts on this issue next. It lives on issues only, one label at a time, and it sits outside the
collection's taxonomy on purpose: `om-*` skills read `labels.pipeline`, `labels.category`,
`labels.meta`, `labels.priority` and `labels.risk` and are unaffected by a key they do not read.

**Intake starts no run.** The invariant of the `## This repository` section of `SDLC.md` is
untouched: `groom`, `autofix`, `spec` and `review-threads` remain the only labels that start work,
and no skill adds one. `ready-for-agent` is a readiness marker a human reads before adding `autofix`
— it is deliberately not a trigger, because whether an `issue.labeled` automation should start
implementation without a person in the cockpit is one of the two operator decisions this ADR defers
to the first retro, and a table in `SDLC.md` is not where that gets settled.

`om-setup-agent-pipeline` was not re-run. Its job on a taxonomy change is to create the labels, and
all four already exist in the repository — `needs-triage` and `ready-for-agent` survive from the
0014 vocabulary this ADR superseded, and the other two were created beside them. Nothing else in the
generated setup reads `labels.intake`.

The live label list had already drifted past decision 2's count of 27 before this amendment:
`autofix`, `groom`, `spec` and `review-threads` are all real and none is in it. That drift is
recorded here rather than repaired, because each of those four is a trigger documented in
`SDLC.md`'s `## This repository` section and in `docs/agents/cezar-automations.json`, and giving
them a group in the config would make them look like state.

## Amendment, 2026-09-17: the deferred question is answered — `ready-for-agent` does start a run

The amendment immediately above states that intake starts nothing, and defers "whether an
`issue.labeled` automation should start implementation without a person in the cockpit" to the first
retro. That is no longer what the repository does, and it was already untrue when the sentence was
written: `docs/agents/cezar-automations.json` defines **Implement ready-for-agent issues** —
`issue.labeled`, `changedLabels: ["ready-for-agent"]`, workflow `implement-ticket` — and it is
enabled in the cockpit. This amendment answers the deferred question rather than repairing the
prose: **yes**, adding `ready-for-agent` starts an implementation run with no person in the cockpit.

What makes that safe is the filter set, not a human at the label:

- `excludeLabels` on the automation stands down on `risk-high`, `security`, `blocked`, `do-not-merge`,
  `needs-info`, `ready-for-human` and `in-progress`. The two categories the process reserves for a
  person are therefore unreachable from this trigger, not merely discouraged by a skill's own rules.
- Only `afk-triage`, `afk-to-tickets` and a human apply the label, and `afk-triage` applies it only
  after an Agent Brief, the Definition of Ready and the SLC scoping rule all pass.
- `implement-ticket` stops when three or more agent PRs already wait in `review`, and nothing merges:
  the run's output is a reviewed PR. The cap is on unreviewed inventory, so a burst of intake cannot
  outrun review capacity.

The invariant the earlier amendment was protecting — that a _trigger_ label is a human's lever and no
skill adds one to its own input — is unchanged. `groom`, `autofix`, `spec` and `review-threads` are
still the trigger labels, still human-applied (except `review-threads`), and still removed by the run
that consumes them. What changes is the claim that intake is inert: intake is the pipeline's own
ladder, and it is allowed to hand work on. `SDLC.md` § Intake labels and § Trigger labels now state
the two mechanisms separately for that reason, and `## This repository` names which of each is wired.

This also records the consequence for decision 2's label count: `labels.intake` is joined in
`.ai/agentic.config.json` by `labels.command` (`groom`, `autofix`, `spec`, `review-threads`) and
`labels.outside` (`do-not-close`). The drift recorded at the end of the previous amendment is
repaired rather than left standing — a label that four live automations read is part of the
taxonomy whether or not it looks like state, and leaving it out of the config is what let the
documentation and the running system disagree.
