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
  ran it. Its remaining coverage either duplicates the first two commands of the gate
  (`src/routeTree.gen.ts`, `drizzle/`) or was wrong — it told a run to regenerate
  `worker-configuration.d.ts`, which in this repository is hand-authored and which
  `wrangler types` refuses to overwrite. `git-guardrails.sh` and `guard-read.sh` stay.
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
  the two that would actually catch a hand-edited generated file.
- `docs/agents/agent-kit.md` is deleted. The router row that pointed at it is gone, and
  `.ai/specs/2026-09-18-agent-kit-check-test-companion.md` — a spec asking the kit to render a test
  for a checker that no longer exists — is archived unimplemented.
- The `FROM` tag in `host/runner/Dockerfile` stays coupled to `@playwright/test` in this
  repository's lockfile, with nothing automated to catch a skew, and the bump is now a pull request
  in `design4pro/cezar`. The kill switch is unchanged: organisation variables `RUNNER_CI` and
  `RUNNER_AGENT` set to `["ubuntu-latest"]`.
- Reverting is a `git revert` of three commits plus re-enabling two workflows in the archived
  repository, for as long as the archive stands.
