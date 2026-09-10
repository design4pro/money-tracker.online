# 0013. Cezar replaces sandcastle as the agent orchestration layer

Status: accepted
Date: 2026-09-03
Supersedes: 0004

## Context

ADR 0004 adopted sandcastle because porting a working orchestrator beat writing one. That reasoning
still holds; what changed is which orchestrator is the working one. Cezar is what the sibling
project now runs, and keeping two orchestration layers across two repositories costs more than
either is worth - every skill, prompt and claim protocol has to be maintained twice, and the two
drift silently because nothing compares them.

Sandcastle had also grown past its own boundary here. It was not a directory of scripts: it reached
into the application, and `SandcastleRegistry` was a Durable Object bound on staging and declared in
`wrangler.jsonc`. An orchestrator that ships inside the product it orchestrates is a coupling worth
paying to remove even before the question of which orchestrator is better.

## Decision

Sandcastle is removed from this repository in full: the loop and its prompts, the four `pnpm
sandcastle:*` scripts, the `@ai-hero/sandcastle` dependency, the `SandcastleRegistry` Durable
Object with its staging binding, and the `SANDCASTLE_COORDINATOR_TOKEN` secret.

Cezar is the intended replacement. Its shape in the sibling project is `.ai/cezar/` holding
`config.json` and one YAML per workflow, with the deterministic steps as `scripts/agent/cez-*.sh`
commands and a single interactive skill as the last step of each file.

**The port is not part of this decision and has not been done.** This ADR records that sandcastle is
gone and that Cezar is where we are going; it does not claim Cezar runs here. Until it is ported,
this repository has no orchestrator and work is driven by hand.

## Consequences

The Durable Object leaves through a `deleted_classes` migration, because the `migrations` list in
`wrangler.jsonc` is append-only: `v2` stays as the record of what staging already ran, and `v3`
deletes the class. This destroys the objects' contents on staging. That is acceptable and was
confirmed before it was done - the registry held issue leases for a loop that no longer exists, and
nothing reads them.

Two things that lived in `.sandcastle/` but were not orchestration go with it, and their loss is
real rather than incidental:

- `setup-e2e.sh` prepared a local Playwright environment, mirroring `.github/actions/e2e-env` step
  for step and additionally passing Polar sandbox credentials through. Without it those steps are
  performed by hand, and the action file is the reference for what they are.
- `record-baselines.ts` recorded `-linux` baselines locally inside the same container image the CI
  gate uses. Without it, `-linux` baselines come only from the `Update e2e baselines` workflow.
  `pnpm e2e:update` still records baselines for the platform it runs on, which is not the same set.

Whatever replaces them belongs under `scripts/`, not under an orchestrator's directory - that
placement is what made them removable by a decision that was not about them.

## Amendment 2026-09-04

**Half of the loss recorded above stopped being a loss.** `record-baselines.ts` mattered because
`-linux` baselines had to come from somewhere; ADR 0016 deleted the baselines, so there is nothing
left for it to have recorded. The `Update e2e baselines` workflow and `pnpm e2e:update` are gone
with them.

`setup-e2e.sh` is the half that was real, and it exists: `scripts/agent/setup-e2e.sh`, under
`scripts/` where this record said such a thing belongs.

## Amendment 2026-09-06

**The port this record asked for was built, and then replaced.** Cezar stayed, as the only
orchestrator; what went was the second process layer the repository grew on top of it - the
`scripts/agent/` claim, ladder, handback and sweeper scripts, the three bespoke workflows and the
label protocol of ADR 0014. ADR 0017 puts the `om-*` skills in their place: Cezar runs a workflow
that is one command step and one `/om-…` slash command, and every write to GitHub goes through the
tracker descriptor. `setup-e2e.sh` became `.ai/scripts/test-env-up.sh` and `test-env-down.sh`, the
`om-prepare-test-env` contract; still the repository's own file, not an orchestrator's, which is
what this record asked for. The cockpit template moved to `scripts/cezar/launchd/`.

## Amendment 2026-09-10

**The cockpit template left the repository, so the path named above leads nowhere.** It moved twice
more: first to `.ai/scripts/launchd/`, when the cezar helpers were consolidated under `.ai/scripts/`
and `scripts/cezar/` was removed; then out of this repository altogether, because the cockpit is one
service per host and its plist was never this repository's property. The template and its cutover
runbook live in `design4pro/agent-kit` (`host/launchd/dev.cezar.cockpit.plist`), and
`docs/agents/cezar.md` is the pointer that follows them.
