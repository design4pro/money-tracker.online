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
- `.claude/hooks/guard-generated.sh` is deleted, with the `PreToolUse` `Edit|Write` matcher that
  ran it. `src/routeTree.gen.ts` and `drizzle/` are already covered by the first two commands of
  the gate, which regenerate and diff them. `git-guardrails.sh` and `guard-read.sh` stay.
  **The hook enforced four rules, not two, and the other two go with it** — worktree confinement
  and the agent-configuration write block, both described under Consequences below. Neither had
  any dependency on the kit; they are dropped here because the file that carried them is, and that
  is a cost of this change rather than a tidy-up it earns.
- **`worker-configuration.d.ts` loses its protection, and nothing replaces it.** Stated plainly
  because the obvious replacement does not work here. The hook blocked edits to that file and told
  the reader to run `pnpm exec wrangler types`; that instruction was wrong — the file is
  hand-authored to mirror `wrangler.jsonc` (its own header says so, and explains why: `wrangler
types` emits an `Env` derived from whichever environment was selected, so a binding declared in
  `env.staging` alone silently becomes required everywhere or vanishes), and `wrangler types`
  refuses to touch it at all: `A non-Wrangler worker-configuration.d.ts already exists`. A
  `wrangler types && git diff --exit-code` gate entry is therefore impossible, not merely
  undesirable: there is no generated form to compare against. `planned.travel` reached the same
  dead end from the other side — there the command does write, and its output fails `tsc` on a
  circular self-reference (its ADR 0025, decision 2). What is genuinely lost is the block: an agent
  may now edit this file, and drift from `wrangler.jsonc` is caught by review alone. A check that
  would work asserts that every `binding`/`name` in `wrangler.jsonc` and every `vars` key appears
  in the interface, without demanding byte equality. It is not written, and this record does not
  pretend otherwise. As of this change the two agree: all 20 declared bindings are present.
- The `.prettierignore` block keeps all 49 surviving paths and is relabelled. They stay out of
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
  person it affects.** This is the whole point of the change.
- The validation gate loses its first command and starts at the generated-file checks, which are
  the two that would actually catch a hand-edited generated file. `ci.yml`'s `Check the agent layer`
  step goes with it, and that step did one thing the gate command did not: run with `--base`/`--head`
  it compared the two tips' locks and failed a branch whose agent layer was **stale** relative to
  its base, on the grounds that `pr-autopilot` checks out the head and would run the old hooks and
  the old workflows. Nothing replaces it and nothing can in the same form — the comparison was
  between two copies of a lock that no longer exists. A branch cut before a pipeline change now
  runs that change's predecessor silently until the base is merged in.
- **Worktree confinement is gone, and nothing replaces it.** Under `CEZ_TASK_ID` or
  `GITHUB_ACTIONS` the hook refused any `Edit`/`Write` whose path walked through `..` or resolved
  outside the current worktree. Its header records the incident that produced the rule: a
  pr-autopilot run reached `../agent-kit/templates/...` and rewrote eight files in a sibling
  checkout a human had uncommitted work in. That particular sibling is being archived, but the
  rule was never about `agent-kit` — it is about a run staying inside the tree it was handed, and
  this repository runs several cezar worktrees at once. `git-guardrails.sh` does not cover it: it
  inspects the Bash command string and has nothing to say about the file-writing tools.
- **The agent-configuration write block is gone, and its loss is largest exactly where it mattered
  most.** Under an agent run the hook refused writes to `.github/`, `.claude/`, `.husky/`,
  `.ai/cezar/`, `.ai/agentic.config.json`, `.ai/trackers/`, `.ai/browsers/`, `.ai/skills/`,
  `.ai/scripts/`, `scripts/ci/`, the two `docs/agents/cezar-*.json`, `.npmrc`,
  `pnpm-workspace.yaml`, `docs/agents/reference.md` and `docs/agents/out-of-scope.md` — absolutely
  under `GITHUB_ACTIONS`, and under cezar with one exception for a path the branch already
  changed. After this change the `PreToolUse` hooks are `Bash → git-guardrails.sh` and
  `Read|Glob|Grep → guard-read.sh`, and neither one looks at a write's path.
  `claude-code-review.yml` restores `.claude/`, `scripts/ci/` and `.ai/agentic.config.json` from
  the base branch before the agent starts, so the branch under review cannot supply its own judge
  — but that restore is a one-time copy, the job runs under `--permission-mode bypassPermissions`,
  and `git-guardrails.sh` is re-read on every `PreToolUse`. A review run can now `Write` over the
  hook that is gating it, or over a `scripts/ci/` script three later steps execute on
  `github.token` with `pull-requests: write`. `git-guardrails.sh` calls itself "the only thing
  between a crafted PR and `gh pr review --approve`"; until this change it was one of two, and the
  block that made the restore stick was the other. Restoring the two rules as a hook named for
  what they do — they need no kit and no lock — is issue #361, kept out of this change so that
  retiring the kit stays revertible on its own.
- `docs/agents/agent-kit.md` is deleted. The router row that pointed at it is gone, and
  `.ai/specs/2026-09-18-agent-kit-check-test-companion.md` — a spec asking the kit to render a test
  for a checker that no longer exists — is archived unimplemented.
- The `FROM` tag in `host/runner/Dockerfile` stays coupled to `@playwright/test` in this
  repository's lockfile, with nothing automated to catch a skew, and the bump is now a pull request
  in `design4pro/cezar`. The kill switch is unchanged: organisation variables `RUNNER_CI` and
  `RUNNER_AGENT` set to `["ubuntu-latest"]`.
- Reverting is a `git revert` of three commits plus re-enabling two workflows in the archived
  repository, for as long as the archive stands.
