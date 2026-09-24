# 0021. The agent layer is vendored, and `design4pro/agent-kit` is retired

Status: accepted
Date: 2026-09-20
Amends: 0013, 0020

## Context

Since kit 24 a set of files in this repository has been _rendered_ rather than written: the
`afk-*` skills, `.ai/cezar/workflows/*.yml` and `.ai/cezar/config.json`, most of `.ai/scripts/`,
`.claude/hooks/*`, `.claude/settings.json`, `.claude/skills/backlog/SKILL.md`,
`.ai/trackers/github.md`, `scripts/ci/*`, three `.github/workflows/` and
`docs/agents/cezar-automations.json`. `design4pro/agent-kit` held the templates,
`.ai/agent-kit.lock.json` recorded a sha256 per path — 52 rendered paths and one watched entry at
`kitVersion` 49 — and `node .ai/scripts/agent-kit-check.mjs` was the **first** command of
`validation.commands`, so a hand edit to any of them failed every pull request.

The arrangement had one job: keep this repository and `planned.travel` from drifting on the
machinery they share. It did that, and charged for it:

- **A rendered file could not be edited here.** A one-line correction to a workflow or a skill was
  a pull request in a second repository, a re-render, a sync PR, and a merge — for a change whose
  reviewer and whose user were the same person.
- **The gate's first command was the slowest way to learn nothing.** It answers "does this file
  hash to what the lock says", which is a question about provenance, not about correctness. Every
  PR paid for it; no PR was ever saved by it from a defect.
- **Sync churn was the dominant commit traffic on the agent layer.** `chore/agent-kit-sync`
  branches were force-pushed into both consumers on every push to the kit's `main`, and reviewing
  them meant reading a diff nobody in this repository had written.
- **Two ladders, one of them idle.** The `afk-*` intake ladder was rendered here and is barely
  exercised; it was kept in step with `planned.travel` at the cost of the three points above.

The convergence the kit bought is also cheaper than it looks now. The two repositories have
diverged in the places that matter anyway — this one provisions no D1 and no basemap, its
`worker-configuration.d.ts` is hand-authored rather than `wrangler types` output — so "identical"
was already "identical except where it isn't", enforced by hashes that cannot tell the difference.

## Decision

**Vendor the agent layer in place. Every rendered file stays byte-for-byte as it is and becomes an
ordinary file of this repository.**

- `.ai/agent-kit.lock.json`, `.ai/scripts/agent-kit-check.mjs` and its test are deleted.
- `node .ai/scripts/agent-kit-check.mjs` is removed from `validation.commands`, from the inlined
  gate in `.ai/cezar/workflows/implement-ticket.yml`, and from `ci.yml`'s `verify` job.
- **`.claude/hooks/guard-generated.sh` is narrowed, not deleted.** The first draft of this record
  removed it outright; the review of that pull request pointed out that the hook was four layers
  and only one of them was the friction this decision is about. Three stay:

  - **Layer 1 — generated files, for everyone, in every mode:** `src/routeTree.gen.ts`, `drizzle/`,
    `worker-configuration.d.ts`. `worker-configuration.d.ts` keeps its block and the block is the
    only thing protecting it, so the message it prints matters: it used to say "run
    `pnpm exec wrangler types`", which is advice this repository cannot take. That file is
    hand-authored to mirror `wrangler.jsonc` — its own header explains why: `wrangler types`
    derives `Env` from whichever environment was selected, so a binding declared in `env.staging`
    alone silently becomes required everywhere or vanishes — and `wrangler types` refuses to
    write it at all (`A non-Wrangler worker-configuration.d.ts already exists`). The message now
    says to change `wrangler.jsonc` and this file together and says not to run that command. A
    block whose instruction cannot be followed sends a run looking for a way around the block.
  - **Layer 2 — worktree confinement in agent runs** (`CEZ_TASK_ID` or `GITHUB_ACTIONS`): no
    `..`, nothing outside the worktree. This layer has an incident behind it: a pr-autopilot run
    rewrote eight files in a sibling checkout a human was working in, and the next sync reported
    "no change". Nothing else in the toolchain closes that route.
  - **Layer 4 — the governance paths under `GITHUB_ACTIONS`, without exception.** The review job
    reads a pull request's contents with a write token, and the pull request may be anyone's. A
    run that can be talked into editing `git-guardrails.sh`, `merge-gate.mjs` or
    `.github/workflows/` can disarm the checks reading it, in the same job.

  **Layer 3 is what goes:** the same governance block in a **cezar** run, together with the
  `in_branch_diff` exception ("the branch already changes this file") that existed only to soften
  it. A cezar run may now edit its own skills, workflows, hooks and validation gate in one commit
  on a branch. `git-guardrails.sh` and `guard-read.sh` are untouched throughout.

- The `.prettierignore` block keeps all 50 surviving paths and is relabelled. They stay out of
  Prettier because reflowing them is a large mechanical diff for no gain, not because a kit owns
  them; deleting a line there is now all it takes to hand a file to Prettier.
- Nothing is pruned. The `afk-*` ladder, the workflows and the hooks are unchanged in content.

**`design4pro/agent-kit` is retired, not merely unsubscribed.** Its `sync-consumers` and
`render-parity` workflows are disabled, this project is removed from the cockpit's registry, and
the repository is archived. Its one piece with a life beyond rendering — the `host/` layer: the
cockpit launchd plist and the self-hosted runner pool — moves to `design4pro/cezar` under `host/`,
documented in that repository's `docs/host/README.md` and recorded in its ADR 0007. Every pointer
here that said "agent-kit's README" now says that.

## Considered Options

- **Keep the kit, drop only the gate command.** Rejected: the lock without the check is a file
  nobody reads, and the sync PRs — the loudest cost — would continue.
- **Prune the `afk-*` ladder while we are here.** Rejected for now. It is a separate decision about
  what the pipeline should do, and folding it in would make this change impossible to revert
  cleanly.
- **Re-point the kit at one consumer and keep rendering.** Rejected: a template repository with a
  single consumer is a directory with extra steps.
- **Move `host/` into this repository.** Rejected: the pool is host-wide state shared with
  `planned.travel`, and a copy in each application repository is the drift the kit was created to
  end. See `design4pro/cezar` ADR 0007 for why the fork's checkout got it instead.

## Consequences

- **Drift between this repository and `planned.travel` is now possible and unpoliced.** That is
  the price. Nothing detects it; the two will diverge where nobody keeps them together, and the
  expectation is that they should be allowed to.
- **A workflow, a hook or an `afk-*` skill is edited here, in one pull request, reviewed by the
  person it affects.** This is the whole point of the change, and it now holds for a cezar run as
  well as for a human: the branch is the unit of review either way.
- **What layer 3 protected is genuinely unprotected in a cezar run.** A run can edit the skill it
  is executing, the workflow that launched it, the hooks that constrain it and the gate that
  judges it — in the same commit as the work. The reason that is acceptable and the GitHub Actions
  case is not: a cezar run's branch is opened by a human who chose the task, the diff is that
  human's to read, and nothing merges without a review that sees the whole of it. Under GitHub
  Actions none of those three sentences is true. If a run ever does quietly weaken its own gate,
  the diff is where it will be visible, so this trade is only as good as the review — say so out
  loud rather than discovering it later.
- `worker-configuration.d.ts` keeps its block, so nothing about editing it changes. What is still
  missing — and was missing before this change too — is drift _detection_: nothing checks that the
  interface and `wrangler.jsonc` still agree. `wrangler types && git diff --exit-code` cannot be
  that check here, because the command refuses the file. `planned.travel` reached the same dead
  end from the other side: there it does write, and its output fails `tsc` on a circular
  self-reference (its ADR 0025, decision 2). A check that would work asserts that every
  `binding`/`name` in `wrangler.jsonc` and every `vars` key appears in the interface, without
  demanding byte equality. It is not written. Checked while writing this: all 20 declared bindings
  are present, so the two agree today.
- The validation gate loses its first command and starts at the two generate-and-diff commands.
  Only one of them is a check: `pnpm generate-routes` rewrites `src/routeTree.gen.ts` whole, so a
  hand edit always shows. `pnpm db:generate` never re-derives existing migration SQL — drizzle-kit
  diffs the schema against the last snapshot and appends only when the schema moved — so a
  hand-edited `drizzle/*.sql`, a hand-added migration plus `_journal.json` entry, or a tampered
  `drizzle/meta/*_snapshot.json` all leave `git diff --exit-code -- drizzle/` clean.
  `drizzle/0002_seed_currency_catalogue.sql` is a `--custom` migration with a hand-authored body,
  so the tree was never fully derived. The first draft of this record called the two commands
  equivalent to the hook's generated-file block and used that to justify deleting it; they are
  not, and layer 1 of the hook is what actually covers `drizzle/`. Recorded because the
  equivalence was wrong, not merely imprecise. `ci.yml`'s `Check the agent layer`
  step goes with it, and that step did one thing the gate command did not: run with `--base`/`--head`
  it compared the two tips' locks and failed a branch whose agent layer was **stale** relative to
  its base, on the grounds that `pr-autopilot` checks out the head and would run the old hooks and
  the old workflows. Nothing replaces it and nothing can in the same form — the comparison was
  between two copies of a lock that no longer exists. A branch cut before a pipeline change now
  runs that change's predecessor silently until the base is merged in.
- **Worktree confinement and the GitHub Actions governance block are kept, after a draft that
  dropped them.** This record's first version deleted the hook whole and justified it on two of
  its four rules. A review of the pull request caught the other two, and issue #361 was filed to
  restore them as a hook of their own. The decision above answers #361 inside this change instead:
  the file comes back narrowed rather than being deleted and rebuilt, so neither rule is ever
  absent from `develop` and there is no window to get wrong. #361 can be closed with this pull
  request.

  Why they had to stay, recorded here because the draft is what made it visible. Confinement:
  `git-guardrails.sh` inspects a Bash command string and has nothing to say about `Edit`/`Write`
  paths, so nothing else in the toolchain keeps a run inside the tree it was handed — and this
  repository runs several cezar worktrees at once. The governance block under `GITHUB_ACTIONS`:
  `claude-code-review.yml` restores `.claude/`, `scripts/ci/` and `.ai/agentic.config.json` from
  the base branch before the agent starts, so the branch under review cannot supply its own judge,
  but that restore is a **one-time copy**, the job runs under bypassPermissions, and
  `git-guardrails.sh` is re-read on every `PreToolUse`. Without the block,
  a review run could `Write` over the hook gating it, or over a `scripts/ci/` script that three
  later steps execute on `github.token` with `pull-requests: write`. `git-guardrails.sh` calls
  itself "the only thing between a crafted PR and `gh pr review --approve`"; it is one of two, and
  this is the other.

- `docs/agents/agent-kit.md` is deleted. The router row that pointed at it is gone, and
  `.ai/specs/2026-09-18-agent-kit-check-test-companion.md` — a spec asking the kit to render a test
  for a checker that no longer exists — is archived unimplemented.
- The `FROM` tag in `host/runner/Dockerfile` stays coupled to `@playwright/test` in this
  repository's lockfile, with nothing automated to catch a skew, and the bump is now a pull request
  in `design4pro/cezar`. The kill switch is unchanged: organisation variables `RUNNER_CI` and
  `RUNNER_AGENT` set to `["ubuntu-latest"]`.
- Reverting is a `git revert` of this pull request's commits plus re-enabling two workflows in the
  archived repository, for as long as the archive stands.

## Amendment 2026-09-22

**The runner scope in the final consequence above is corrected.** `RUNNER_CI` and `RUNNER_AGENT`
are repository variables, not organisation variables, and currently both name
`["blacksmith-2vcpu-ubuntu-2404-arm"]`. The kill switch remains the same: changing either
repository variable moves only this repository's CI or agent jobs. The original decision and every
other consequence stand unchanged.
