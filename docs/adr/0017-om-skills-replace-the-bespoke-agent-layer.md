# 0017. The om skill collection replaces the bespoke agent layer

Status: accepted
Date: 2026-09-06
Supersedes: 0014
Amends: 0013
Amended by: ADR 0029 (the `groom` / `autofix` / `spec` command labels and `review-threads` are gone,
and so is the automation that ran on the last).

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

`pr-review-threads` was the name of the automation that turned a PR with unresolved threads into an
`om-auto-fix-pr` run, and `review-threads` was its trigger label; both are retired (ADR 0029,
`d704377`, see the 2026-10-05 amendment). Nothing in this repository applied
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
outside both, and a GitHub Action is the only place left. (Both halves of that parenthesis have
since expired; see the 2026-09-20 amendment at the end.) The list of logins in the first sentence
has since grown as well - Codex joined it under both of its login forms - while the restriction it
describes stayed exactly as deliberate; see the 2026-09-21 amendment.

What this costs, stated plainly, is the thing decision 6 was avoiding: two review passes on a pull
request, one from `om-auto-review-pr` inside the cezar run and one from the Action. That is the
price, it is paid on every PR, and it buys the only automated route from "the review left something
unresolved" to "something clears it". The drift objection is narrower than it was in the original
context: the Action runs the upstream `code-review` plugin rather than a bespoke reimplementation,
and it is now one of the files kept identical between this repository and `planned.travel`, where
the same chain runs. (That convergence was the agent kit's until ADR 0021 retired it; see the
2026-09-20 amendment.)

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

## Amendment, 2026-09-20: `guard-generated.sh` no longer refuses `.claude/` in a cezar run

The amendment of 2026-09-07, under **Skill versions are pinned, not floating**, gives as one reason
for vendoring the collection that a gitignored `.agents/skills/` "put the collection outside
`guard-generated.sh`, which refuses edits under `.claude/`". The relative clause has stopped being
true in general. ADR 0021 narrowed that hook: the block on `.claude/`, `.github/`, `.ai/cezar/`,
`.ai/skills/`, `.ai/scripts/`, `scripts/ci/` and the rest of the governance set now applies under
`GITHUB_ACTIONS` only. A cezar run may edit those paths, and the review of its branch is what
judges the edit.

Read that sentence as the record of a 2026-09-07 decision, which is what it is. The argument it
was making survives the narrowing intact and is worth restating in current terms: vendoring is
what makes a skill version **reviewable and reproducible** — a file in the checkout, at a SHA
`.ai/cezar/config.json` names, whose change is a diff a human reads. That was always the load-
bearing half. The hook was the belt-and-braces half, and it is now belt only, and only under
GitHub Actions.

Decision 2's own text is unaffected: `.claude/skills/om-*` and `skills-lock.json` are still
committed, the pin still moves in the same commit, and an upgrade is still a pull request read
with `om-apply-upgrade-notes`.

## Amendment, 2026-09-20: three mechanisms this ADR reasons from no longer exist

The 2026-09-08 amendment above ("decision 6 is superseded") argues from three facts that have all
expired. The decision it reached still stands — the Action is still what arms `review-threads`, and
`scripts/ci/review-threads-label.mjs` still restricts arming to review bots rather than people -
`claude`, `claude[bot]` and `github-actions[bot]` as of this date, Codex's two logins since (see the
2026-09-21 amendment) — but the reasoning should not be re-derived from what it says.

- **`.ai/scripts/cezar-host-patch.sh` is deleted.** ADR 0021 retired `design4pro/agent-kit` and
  vendored the host layer in place; the patch set went with it. A reader sent to that file finds
  nothing.
- **Cezar no longer drops label events on pull requests.** The patch existed because it did.
  Cezar 0.11.1 takes `filters.includePullRequests` on a `github` automation
  (`packages/cezar/src/automations/github-poller.ts`), and the committed "Resolve blocking review
  threads" definition in `docs/agents/cezar-automations.json` already sets it. The upstream gap
  this ADR worked around is closed.
- **There is no agent-kit convergence.** `merge-gate.yml`, `claude-code-review.yml` and
  `.ai/trackers/github.md` are ordinary files of this repository, edited here. They are still kept
  in step with `planned.travel`, but by a person making the same change twice, not by a renderer.

What does **not** follow from the second point: that the Action should be replaced by a cezar
automation. The Action is also the only producer that sees a review event at all, and it is the one
place the arming decision can read the thread author before the label exists. The workaround became
unnecessary; the reason underneath it did not.

## Amendment, 2026-09-20: a short deny list returns, as a backstop and not as the boundary

The 2026-09-07 (second) amendment above says `.claude/settings.json` is hooks-only and that the
deny list "no longer exists". `.claude/settings.json` now carries a `permissions.deny` of twelve
entries again. The two are less in conflict than they read, and the distinction is the point.

That amendment's argument was about `deny` as a **boundary**, and it is correct: a prefix matcher
misses `pnpm run deploy` and `wrangler versions deploy`, it cannot read a command the way
`git-guardrails.sh` does, and it cannot explain itself to the model it refuses. Nothing here
disputes that. The boundary is still the hooks, and every rule in the new deny list also exists in
`git-guardrails.sh`, with its reasoning and its cases.

What the amendment did not weigh is the failure mode the hooks have and `deny` does not: the hook
is a script, and a script can be edited, or can error. Both happened while this list was being
written. `.claude/hooks/guard-generated.sh` deliberately stopped refusing `.claude/` in a cezar run
(the 2026-09-20 amendment above), so a run can now edit the very file that restrains it. And the
first draft of the new `rm -r` rule escaped the project root with a `sed` expression BSD `sed`
rejects, which under `set -e` ended the hook with **exit 1** — a status the harness reads as
_allowed_. For the length of that draft, every rule in the file was inert and nothing said so.

So the split is by failure mode, not by rule:

- **The hooks carry the reasoning.** Every rule, its comment, its tier, and its case in
  `.claude/hooks/__tests__/hooks.test.ts` — including the ordinary command each rule must not
  block, which is the half a prefix matcher cannot express at all.
- **`permissions.deny` carries the few that must survive the hook not running.** `deny` is
  evaluated by the harness before any hook, wins over `ask` and `allow`, and applies in every
  permission mode including the `dontAsk` a cezar run uses and the `bypassPermissions` of the
  review job. It is deliberately too short to reason with: the irreversible set only.

It names the exact secret files rather than a glob, because `.dev.vars.example` and
`.env.local.example` are files `AGENTS.md` sends a reader to, and `Read(./.dev.vars.*)` would have
refused them — the same over-breadth the 2026-09-07 amendment warned about, arriving from the
other direction.

Decision 3's text is unaffected: the hooks are still what the skills' GitHub access is loosened
against, and they still keep blocking destructive git, environment dumps and `--no-verify`.

## Amendment, 2026-09-22: prefix denials yield to tested command-aware enforcement

The three prefix denials for `rm -rf /`, `git push --force`, and `git push -f` are removed. They
blocked ordinary feature-branch force-pushes and cezar scratchpad cleanup before the hook could
evaluate the command's target. The hook now closes the two omitted cases that review found: a
force-push without a refspec while `develop` or `main` is checked out, and a recursive deletion of
an absolute path other than the disposable `/tmp/claude-*` scratchpad. Its regression cases cover
the protected and permitted commands together.

## Amendment, 2026-09-21: the arming allowlist names Codex, and a bot needs one entry per login form

Two sentences above date from when `DEFAULT_REVIEW_BOTS` in `scripts/ci/review-threads-label.mjs`
held exactly `claude`, `claude[bot]` and `github-actions[bot]`: the one in the 2026-09-08 amendment
that introduces the restriction, and the one in the 2026-09-20 amendment that restates it. The list now also carries
`chatgpt-codex-connector` and `chatgpt-codex-connector[bot]` (#405, #406). Read both sentences as
the record of their dates; this is the current membership.

**The criterion, which is what a reader assessing the safety model actually needs.** A login belongs
on the list when the account posts review threads this pipeline is expected to answer - a review
bot, not a person. That is the same boundary the 2026-09-08 amendment drew and gave its reason for:
a human's review thread is a conversation, and starting an autofix run on one is how a disagreement
gets bulldozed. Adding Codex does not move the boundary; it corrects the list's membership against
it. Codex reviews every pull request here and its threads were being read as a person's, so the
`review-threads` label never armed and the findings went out with the squash - silently, because a
login that is absent produces no log line and no failure.

**Two entries per bot, because the two GitHub APIs disagree.** GraphQL's `Bot.login` returns a
GitHub App's slug without the `[bot]` suffix that REST carries, and `decide` is called with
whichever form the caller read. A bot entered under one form only is half-registered: it arms
through the caller that reads REST and not through the one that reads GraphQL. The unit test pins
every login each bot posts under, so that half-registration now fails there rather than in CI.

`chatgpt-codex-connector[bot]` was read from the API - the REST review comments on #402 list
exactly two authors, `claude[bot]` and `chatgpt-codex-connector[bot]`, both of type `Bot`. The
suffix-free form was **not** re-measured: GraphQL answered `RATE_LIMIT` for that account on the run
that added it, and GraphQL is the read this script actually performs. It is carried on the same
basis as the `claude` / `claude[bot]` pair already in the list, which is reasoning about the API
rather than a reading of it. An entry that never turns up costs nothing, so carrying both is the
safe side of the uncertainty either way.

## Amendment, 2026-09-30: `risk-high` and `security` leave the filter for a specialist's verdict

The 2026-09-17 amendment above makes `excludeLabels` on **Implement ready-for-agent issues** stand
down on `risk-high` and `security`, so that "the two categories the process reserves for a person
are unreachable from this trigger". The owner reversed that choice for full autonomy: an unattended
run no longer leaves a choice between options to a person, it hands the question to an independent
specialist sub-agent and continues on the verdict (`SDLC.md` § Delegated decisions,
`.ai/skills/afk-decide/SKILL.md`). `risk-high` and `security` work reaches `ready-for-agent` only on
the security and tenancy specialist's approving verdict, whose conditions become acceptance
criteria in the brief, and the two labels are gone from `excludeLabels`.

What still bounds the lane: the automation keeps `allLabels: ["risk-low"]`, so an issue labeled
`risk-high` earns its brief and `ready-for-agent` and then waits for a person to start it; the WIP
cap and the review and QA gates in `SDLC.md` are unchanged; and a `security` issue that is
`risk-low` now starts by itself, which is the case the specialist's verdict exists for.

## Amendment, 2026-10-01: one identity, and the lane runs at every risk level

The owner retired the `design4pro-agent` account: every agent action runs as `rafalwolak`, so the
dedicated account and its PAT (amendment 2026-09-07) are gone, and the scope guard that PAT gave
moves to a fine-grained token for the cockpit alone (`docs/agents/cezar.md`, Host identity). The
implementing automation drops `allLabels: ["risk-low"]`: the security and tenancy specialist's
approving verdict is the gate for `risk-high` and `security`, and every other judgement call goes
to a specialist sub-agent (`.ai/skills/afk-decide`). What still bounds the lane: the WIP cap, the
review inside the chain, and the QA gate - a run signs off below `risk-high` on a QA specialist's
verdict, and a `risk-high` PR waits for the owner's `qa-approved`. Merging is ADR 0027's, amended
the same day.

## Amendment, 2026-10-04: the token boundary is the table in the cockpit guide, not a list here

**Consequences** > **Security moves** names the token boundary as "(Contents, Issues, Pull requests;
no Workflows)". That list was already short when it was written and has drifted since: the pipeline
also needs `Actions: read` (list-runs, get-run, watch-run), `Commit statuses: read` (the status half
of get-pr-checks) and, later, `Actions: write` (rerun-failed). The text above stays as it was
written; it is no longer the reading to use.

The current reading is the "Token scopes the pipeline needs" table in `docs/agents/cezar.md`, which
pairs each permission with the tracker operations it serves and dates the snapshot of what a token
held. That table describes the retired bot token (amendment 2026-10-01) and says so; its permission
to operation mapping is the durable half, because GitHub's API fixes it. This ADR does not restate
the list, so the next scope change edits one place.

## Amendment, 2026-10-05: the review-threads automation and the Action that armed it are gone

`d704377` (2026-09-23, "ci: remove Claude Actions workflows") deleted `claude-code-review.yml`,
`rearm-review-threads.yml`, `scripts/ci/review-threads-label.mjs` and the "Resolve blocking review
threads" definition from `docs/agents/cezar-automations.json`, which is the automation the
2026-09-08 amendment called `pr-review-threads`. ADR 0029 records the consequence: nothing arms
`review-threads` any more, and the label is gone with the rest of the command labels.

Two statements above are therefore the record of their dates and no longer describe the system: the
2026-09-08 amendment's "the review Action returns as the arming signal", and the 2026-09-20
amendment's "the Action is still what arms `review-threads`" and "the committed 'Resolve blocking
review threads' definition ... already sets it". The 2026-09-21 amendment's allowlist is likewise
the membership of a script that no longer exists. None of them is edited in place.

`pr-fix` (`/om-auto-fix-pr`) remains as a manual workflow: a person starts it on a pull request
whose threads are still open, as `docs/agents/cezar.md` describes.

## Amendment, 2026-10-05: no SHA is recorded in the lockfile or in the config

Three passages above say the collection's SHA is recorded somewhere: decision 2's "**Skill versions
are pinned, not floating**" paragraph ("`.ai/cezar/config.json` names the SHA", "the pin moves in
the same commit", "one mechanism and one SHA"), the paragraph after decision 6 ("The collection's
SHA is therefore recorded in `skills-lock.json` alone"), and the 2026-09-20 amendment's "at a SHA
`.ai/cezar/config.json` names". None of them was ever true. Every `skills-lock.json` entry carries
`source`, `sourceType`, `skillPath` and `computedHash`, and `skillsRepos` in `.ai/cezar/config.json`
is empty and names nothing. The SHA is recorded neither in the lockfile nor in the config, and
nowhere else.

What vendoring does give is unchanged and is the argument that stands: a skill version is
**reviewable and reproducible** through the committed tree. `.claude/skills/om-*` is a file in the
checkout, so a worktree has the collection the moment it is cut and an upgrade is a diff a person
reads with `om-apply-upgrade-notes`. The lockfile's per-skill `computedHash` is provenance for each
entry point (`SKILL.md`) only; it does not cover the `references/*.md` files, so it is not what
makes a run reproducible, the committed tree is. `skillsRepos` stays empty, for the reason given
after decision 6.

The text above is left as written, the record of what it said on its dates, and is not the reading
to use. The current wording is in `AGENTS.md` (Process and skills) and `docs/agents/cezar.md`
(the config paragraph and the "Skills" bullet).
