# 0033. An agent attestation stands in for the gate on a pull request

Status: accepted
Date: 2026-10-24
Amends: 0022 (one seconds-long job runs GitHub-hosted). The required-check names, the merge authority, the e2e legs and the deploy gate are unchanged.

## Context

This repository shares the VPS `ci` pool with design4pro/planned.travel: two slots of 4 CPU /
8 GB (ADR 0022). Measured 2026-10-15..23, the pool is the bottleneck, not the work: job queue
medians were 33-111 min (p90 up to 187 min), while a pull request run spent about 50 slot-minutes.
Each merge then runs the whole suite again on the `develop` push, on the same two slots.

The agent that wrote the change has already run the same commands: `validation.commands` is the
gate `implement-ticket` passes before it opens a pull request (SDLC.md § Validation gate). It runs
on the agent host, which has the CPU the pool lacks. The second run, on a slower machine, rarely
tells anyone what the first did not. ADR 0021 in planned.travel measured why the answer cannot be
"trust the agent's report": before CI gated anything there, CI then caught real defects the reports
had missed. So the report has to be something CI can check.

planned.travel adopted this as its ADR 0045. This is the same mechanism, ported.

The e2e legs (two of 18-20 min each) were meant to move to the agent host too. The first local run
(2026-10-23, `vite dev`, 4 workers, while other agent runs were testing on the same 8-vCPU host)
took 3.3 h and ended with 75 failed and 101 flaky of 832 journeys, nearly all timeouts. Until the
journeys run on a built preview and are measured on a quiet host, they stay in CI.

## Decision

1. **The agent leaves an attestation**: a pull request comment found by the marker
   `<!-- agent-attestation -->`, written by `scripts/ci/attestation.mjs`. `run` executes
   `validation.commands` of the committed head in order from a clean tree, records each exit code,
   and keeps nothing when one is red. The whole run holds `flock ~/.cache/cez/gate.lock`, one gate
   per host at a time: two of them time each other's tests out (both repositories' first local runs
   did, 2026-10-23). `post --pr <n>` publishes the record; `attest --pr <n>` does both. The record
   carries the head's **tree hash**, not its SHA: a rebase that keeps the content keeps it, and one
   more commit voids it.
2. **A job `agent attestation` judges it** (`attestation.mjs verify`, GitHub-hosted, seconds). It is
   accepted only when all of these hold:
   - a trusted author wrote it (`OWNER`, `MEMBER` or `COLLABORATOR`);
   - its tree hash is the pull request head's tree;
   - it ran exactly the **base branch's** `validation.commands`, in order, each with exit 0;
   - the diff touches none of the paths that define the gate or the journeys, or are `risk-high`
     (`.github/`, `scripts/`, `.ai/scripts/`, `.ai/agentic.config.json`, `package.json`, the
     lockfile, tool and test config, `wrangler.jsonc`, `e2e/baseline-day.ts`, `src/server/auth`,
     `billing`, `ledger`, `do`, `db`, `repos/base.ts`, `repos/scope.ts`, `src/lib/money/`,
     `drizzle/`);
   - the diff is non-empty and shorter than the files API's limit.
3. **On a valid attestation**, `generated · typecheck · lint · build` and `unit tests · coverage`
   are skipped. A skipped required check counts as passed, so the rulesets keep requiring the same
   names. The e2e legs and `e2e · merged report` never depend on it. A push to `develop` or `main`
   never skips anything: `attestation` runs on pull requests only, and the deploys keep waiting on
   `verify`, `test` and `e2e` (ADR 0020).
4. **`implement-ticket` makes it deterministic.** The gate step is `attestation.mjs run`, not a
   prompt, so a long session or a free-form Continue cannot skip it; the merge step posts with
   `attest` after the last push, which re-runs only when a fix round changed the tree. The implement
   step gets `timeoutMinutes: 90` (design4pro/cezar#73), because the runner's 30-minute default is
   what pushed planned.travel's runs into free-form sessions that never attested.

## Consequences

- **Fail-open to the old behaviour.** A missing or stale comment, an API error in the judging job,
  a diff in the excluded paths: all end in the full jobs running. The only way to a skipped job is a
  positive, checkable record.
- **Some failures move from the pull request to the `develop` push.** The record proves the head,
  not the merge result (`strict` is off, ADR 0032). Coverage thresholds (`test:coverage`), the
  build-left-the-route-tree check and the no-pinned-day check in `verify` are not in
  `validation.commands` either. The push run still runs all of them and blocks the deploy, so
  nothing red ships; it can hold `develop` red until the next fix.
- **The saving is the smaller half.** The e2e legs, about 75% of a pull request's pool time, still
  run there; moving them is a later decision with its own measurement.
- **The lock serializes gates host-wide**, and helps only once every gate on the host takes it: an
  agent's hand-run `pnpm test` during implement does not.
- **Trust is a collaborator's.** A collaborator could post a false record, as one can already merge;
  the tree binding and the push run bound what that is worth. Signing was rejected: it needs keys.
- **One job leaves the pool**, against ADR 0022: `agent attestation` runs on `ubuntu-latest`. It
  uploads no artifact (the storage quota was 0022's first reason) and needs no host (its second);
  on the pool it would queue behind the jobs it skips. `ci-runner-invariants.test.mjs` allows that
  job and no other.
- **Rollback** is reverting the `attestation` job and its `needs`/`if` clauses in `ci.yml`; no
  setting outside the repository moved.
