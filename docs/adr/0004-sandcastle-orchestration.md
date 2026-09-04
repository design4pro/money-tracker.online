# 0004. Sandcastle is the agent orchestration layer, ported rather than reinvented

Status: superseded
Superseded by: 0013
Date: 2026-09-01

## Context

This product is built largely by agents. That requires an orchestrator: something that claims work
from the backlog, plans it, fans it out to bounded agent runs, validates each run against a real
verification ladder, retries within a budget, and merges what passes.

We had a choice between writing one for this repository and porting the one that already runs
`planned.travel` — roughly 4 000 lines across a coordinator, a claim/lease registry, a usage-limit
handler, a validation ladder, a fix loop and nine prompt files, all of which have been through
hundreds of real runs.

Writing a new one is tempting because the existing one carries assumptions from another product
(a basemap cache, a tiles bucket, a twenty-three-locale parity rung). Those are visible and
removable. What is not cheaply reproducible is the accumulated knowledge of the failure modes: the
BSD `date` fallback that must be chosen from the value rather than the exit status, the
`--reporter` comma-list versus the repeatable `--project` flag, the `rm -f results.json` before every
run, the unparseable verdict that must throw rather than be spent as a fix attempt.

## Decision

We port `.sandcastle/` and keep its design invariant intact:

> **The agent tree is one level deep. `main.ts` is the only orchestrator. New capability is a new
> stage with its own lease-bounded slot, never a nested call.**

Most files are copied verbatim: the coordinator, the claim CLI, the run-id parser, the issue-edge
extractor, the adoption ladder, the stage log, the usage-limit handler, the report renderer, and the
whole test suite around them. Re-parameterised: the repository slug, the branch prefixes, the Docker
sandbox mounts, the Sentry project. Rewritten: the validation ladder's rungs and the e2e setup
script, which lose a basemap and gain a database-drift rung.

Two changes are ours rather than the port's:

1. A **`db-drift`** rung — `pnpm db:generate && git diff --exit-code -- drizzle/` — so a schema edit
   without a committed migration fails in the sandbox rather than in production.
2. A mandatory **`### Money invariant`** heading on every plan stage, and a corresponding
   money-invariant test surface, because in this product the arithmetic boundary is exactly as
   load-bearing as the tenant boundary.

## Consequences

We inherit a working loop on day one, including the parts nobody would have thought to write:
adoption gated on ancestry-or-clean-merge and never forced, `execFileSync` with an argv array for
anything sourced from the registry, revoked leases tracked separately from in-flight ones with a
merge-time backstop, advisory stages that swallow their own errors, and a timeline that separates
work time from wait time.

We also inherit its constraints. `MAX_PARALLEL` stays at 2 because the sandbox VM runs a Vite dev
server, a local D1 simulation and two browser engines per validation. The prompts carry a
`RATIONALIZATIONS` table that has to be maintained by hand. `main.ts` lives in the operator's
checkout while `validate.sh` lives in the sandbox's, so the two are versioned together and deployed
apart — a mismatch is a confusing failure and there is no mechanism preventing it.

And we inherit an upstream we do not control: `@ai-hero/sandcastle` 0.12.0 has a bug where `resume()`
clears `promptFile` but not `promptArgs`, which is why `fix-prompt.md` is templated by hand with
`replaceAll` instead of using the library's substitution. That workaround has to survive until the
upstream fix lands, and it will look inexplicable to anyone who does not read this record.
