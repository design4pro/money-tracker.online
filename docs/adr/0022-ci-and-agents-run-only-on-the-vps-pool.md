# 0022. CI, deploys and agent jobs run only on the VPS pool

Status: accepted
Date: 2026-09-24
Amends: 0021

## Context

Until now this repository's jobs could land on any of three kinds of runner: the self-hosted pool
of ephemeral containers on a Mac, Blacksmith's hosted machines, and GitHub-hosted `ubuntu-latest`,
chosen by `RUNNER_CI`, `RUNNER_DEPLOY` and `RUNNER_AGENT`. Two things ended that.

- **Artifact storage ran out.** GitHub Team includes 2 GB of Actions storage, measured in
  GB-hours over the month. The organisation used 1488 GBh in September 2026 against an allowance
  of about 1440 (339 GBh of it this repository's coverage, blob and HTML reports), and from then on
  every `upload-artifact` failed with `Artifact storage quota has been hit`.
- **The Mac pool was down.** It runs as a LaunchAgent, so it stops when nobody is logged in. From
  2026-09-23 no `ci` or `agent` runner was registered, and the merge gate, promotions and deploys
  queued with nothing to take them.

## Decision

**Every job runs on the self-hosted pool on the OVH VPS** (8 vCPU KVM Intel Haswell, 22 GB),
runner group `vps`, scoped to this repository and `design4pro/planned.travel`. It is the same
image and the same `pool.sh` the Mac used (design4pro/cezar, `host/runner`, "Linux host"): one
job per container, thrown away afterwards. There are three pools:

| pool  | labels                                  | slots            | runs                                                                                                       |
| ----- | --------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| ci    | `["self-hosted","linux","X64","ci"]`    | 2 × 4 CPU / 8 GB | `ci.yml`, `a11y.yml`, `deploy-staging.yml`, `deploy-production.yml`                                        |
| gate  | `["self-hosted","linux","X64","gate"]`  | small            | `merge-gate.yml`, `trusted-merge-gate.yml`, `governance-gate.yml`, `auto-merge.yml`, `promote-develop.yml` |
| agent | `["self-hosted","linux","X64","agent"]` | small            | jobs that read `RUNNER_AGENT`                                                                              |

The `gate` jobs take seconds. They get their own pool so they never queue behind a 20-minute e2e
leg on one of the two `ci` slots.

**Artifacts stay on the VPS.** `design4pro/.github`'s `artifact-upload` and `artifact-download`
replace the upstream actions. On the pool they write to `/srv/ci-artifacts/<owner>__<repo>/<run>/`,
mounted into `ci` containers only, and nothing reaches GitHub storage. The host deletes runs older
than 14 days. The step summary names the path; fetch the files with `scp`.

**The kill switch stays.** `RUNNER_CI`, `RUNNER_DEPLOY` and `RUNNER_AGENT` are unset repository
variables. Each `runs-on` falls back to the array beside it, and setting one to
`["ubuntu-latest"]` moves those jobs to GitHub-hosted machines without a pull request. On a
GitHub-hosted runner the artifact actions fall back to GitHub storage, and with it to the 2 GB
allowance.

## Consequences

- **The VPS is about three times slower per core than the Mac.** Measured in run 35971204308,
  dispatched from `develop` with the old budgets:
  - `generated · typecheck · lint · build` passed.
  - The accessibility gate passed (run 35971207452).
  - `mobile-chromium` got through 238 tests in the 900 s `globalTimeout`, with 32 not run.
  - `chromium` ran 287 tests for 14.3 min after ~6 min of setup and was cancelled by the 20-minute
    job cap.

  The budgets move rather than the shard count, because two `ci` slots cannot run more legs at once
  and each leg pays the setup again: Playwright's `globalTimeout` on CI is 30 min and the e2e job's
  `timeout-minutes` is 40. Per-test timeouts are unchanged.

- **One machine.** A VPS outage stops the gate, promotions and shipping together. Recovery is the
  kill switch above.
- **One writable mount, shared.** Every job in the `vps` runner group can read and write every
  run's artifacts. It holds reports, never tools, and only the two repositories in the group can
  schedule jobs there.

## Amendment 2026-10-18 (PR verification leaves the VPS)

Amended by ADR 0033. The `ci` pool still runs **deploys** (`deploy-staging.yml`,
`deploy-production.yml`), **promotion-PR opening** (`promote-develop.yml`), and an optional
dispatched axe scan. It no longer runs a verification suite on every pull request. `ci.yml` is
removed. The kill switch `RUNNER_DEPLOY` stays for shipping; `RUNNER_CI` remains for promote and
dispatch-only axe. Cursor cloud agents run generate, typecheck, lint, unit tests, e2e and axe.
