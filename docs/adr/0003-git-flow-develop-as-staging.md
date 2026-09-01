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
