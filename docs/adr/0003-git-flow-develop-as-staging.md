# 0003. Git Flow with develop-as-staging

Status: accepted
Date: 2026-09-01

## Context

The project deploys two long-lived environments from one repository, and a fleet of agents produces
branches continuously. Those branches need somewhere to land that is verifiable by a human before
anything reaches people's real financial data.

Trunk-based development with feature flags is the obvious alternative and is a good fit for many
products. It is a poor fit here for two specific reasons: a migration is not feature-flaggable in
the way a UI change is, and a money bug that reaches production is not recoverable by flipping a
flag, because the wrong numbers have already been read and acted on.

## Decision

Feature branches (`feat/*`, `fix/*`, `chore/*`, `claude/*`, `sandcastle/*`) target **`develop`** via
pull request. Merging `develop` auto-deploys **staging**. Promotion is a pull request
`develop` → **`main`**, and merging that deploys **production**.

CI runs the full gate on every pull request: lint, typecheck, unit tests, build, the route-tree
drift check and the migration drift check. The e2e visual gate runs on push and on pull requests
labelled `needs-e2e`.

Database migrations are **additive**, so a running Worker survives the migrate-then-deploy window
(`docs/ARCHITECTURE.md` §9).

## Consequences

Agents always cut from and target `develop`; the orchestration loop's base branch and pull-request
base are `develop` in every place they appear, and two spellings would be two pipelines.

Staging is the human-QA surface. QA findings return to the backlog as GitHub issues with `qa-failed`
rather than being fixed in place, so the record survives. `main` only ever receives what staging has
already run.

The costs: two long-lived branches drift, and a promotion pull request that sits for a week
accumulates a merge conflict surface nobody wanted. Hotfixes to production have to be cut from
`main` and back-merged to `develop`, which is a step people forget. And every change pays for two
deploys instead of one.

The mitigation for the drift is cadence — promote often, in small pull requests — not tooling.

## Amendment 2026-09-03

Appended rather than superseded: the decision - `develop` is staging, promotion to `main` is a
pull request - is unchanged and still right. Two names it used stopped existing, and a record that
names a branch prefix and a label nobody can create is a record that sends the next fresh context
looking for them.

**`sandcastle/*` is gone.** ADR 0013 removed the orchestrator that cut those branches. Cezar cuts
`cez/<id8>` instead, one per run, and `scripts/agent/cez-setup.sh` creates it as a worktree. The
prefix list reads `feat/*`, `fix/*`, `chore/*`, `claude/*`, `cez/*`. Nothing else about the flow
moved: a Cezar run targets `develop` through a pull request exactly as a human branch does, and
`.ai/cezar/config.json` sets `baseBranch: develop` for that reason.

**`qa-failed` is gone, and nothing replaces it.** ADR 0014 closed the label vocabulary at nineteen,
and a QA outcome axis is not among them. A staging QA finding is now filed the way every other
finding is: a new issue carrying `status: triage` and a `type:`, which a triage run reproduces at
HEAD and routes. The original consequence still holds and is what mattered - the finding returns to
the backlog as an issue rather than being fixed in place, so the record survives. It simply does
not need a label of its own to say where it came from; the issue body says that.

## Amendment 2026-09-04

**The e2e trigger sentence above is void.** ADR 0016 deleted `needs-e2e` along with the screenshot
gate it existed to make optional. The browser suite now runs on every pull request, unlabelled,
like the rest of the gate. Everything else in this record stands: the flow, the two environments
and the promotion pull request are unchanged.

## Amendment 2026-09-04 (promotion tooling)

Two gaps between this record and what the repository actually did, both now closed.

**Dependabot was opening its bumps against `main`.** It carries no `target-branch`, and the default
for that field is the repository's default branch - so every weekly bump proposed a change that
skipped staging, in a flow whose whole premise is that `main` only receives what staging has already
run. `.github/dependabot.yml` now sets `target-branch: develop` on both ecosystems. Pull requests
opened before this change keep their old base; closing one makes Dependabot recut it against
`develop`.

**The promotion pull request is now opened by a workflow.** Every push to `develop` runs
`.github/workflows/promote-develop.yml`, which opens `develop` → `main` if no such pull request is
open and does nothing when one already is.

That qualifies the sentence above - "the mitigation for the drift is cadence, not tooling" - without
overturning it. The tooling does not promote anything and cannot: it opens a pull request and stops,
and a human still reviews and merges, which is still the act that deploys production. What it
removes is the case where the diff to production went unnoticed because nobody had opened the pull
request that would have shown it. Cadence is still the mitigation; this only keeps the meter in
sight.

A pull request opened with the default `GITHUB_TOKEN` does not trigger `pull_request` workflows,
so it would carry no checks. The workflow therefore reads `secrets.PROMOTE_PR_TOKEN` first and only
falls back to `GITHUB_TOKEN`; setting that secret to a fine-grained PAT or a GitHub App token gives
the promotion pull request the same checks as any other. The fallback is not a broken state - ci.yml
and a11y.yml also run on push to `develop`, so the promoted commit has already been through the full
gate - but it is the degraded one, and provisioning the secret belongs in the repository setup
runbook.

## Amendment 2026-09-06 (branch prefixes of the om skills)

**The agent's branches changed name with ADR 0017.** The `om-*` skills cut `fix/issue-<n>-<slug>`
for a fix, `feat/<slug>` for a feature and `spec/<slug>` for a design-only pull request that lands
a document under `.ai/specs/`; `claude/*` for hand-started sessions and `cez/<id8>` (Cezar's
worktree branches, never pushed) stay. All of them open a pull request to `develop`, and nothing
here changes what promotes to `main`.
