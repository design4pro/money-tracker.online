# money-tracker.online

Multi-tenant SaaS personal finance manager on Cloudflare Workers (TanStack Start + React 19,
D1/Drizzle, KV, R2, Queues, one Durable Object). shadcn-shaped UI on **React Aria Components**, not
Radix. Package manager: pnpm. The stack is pinned (`docs/SPEC.md` §3). There are no bank connectors
and adding one is out of scope permanently (`docs/adr/0008-no-bank-connectors.md`).

This file is the router. It stays under 32 KiB; detail lives in the documents the table points at.

## Always

- Money stays in integer minor units at every layer. The scale is `currencies.digits`, never a
  hard-coded 2. `ref_amount_minor` is historical and never recomputed (`docs/MONEY.md`).
- All SQL lives in `src/server/repos` and goes through the tenant-scoped base repository;
  `src/server/catalog` is the single exception (`docs/SPEC.md` §6.1).
- Validate every server-function input with Zod, and parse it a second time in the repository.
  Validation is shape, never permission.
- A new repository function ships with a case in `src/server/repos/__tests__/tenant-isolation.test.ts`;
  a new money-touching write path with a case in `src/server/repos/__tests__/money-invariants.test.ts`.
- User-facing copy lives in the EN + PL catalogue and a new key lands in both locales in the same
  change (skill `i18n-messages`).
- Named exports only, route modules excepted. `components/ui` never fetches and never imports from
  `server/`.
- Regenerate, never edit: `src/routeTree.gen.ts` (`pnpm generate-routes`), `drizzle/`
  (`pnpm db:generate`) and `.ai/specs/README.md` (`pnpm generate-spec-index`). Migrations are
  additive.
- Anything slow is enqueued on `TASKS`; balances are rebuilt through the `LEDGER` Durable Object.
- Conventional Commits in English, scope = module or plan area. Branches `fix/issue-<n>-<slug>`,
  `feat/issue-<n>-<slug>`, `spec/<slug>`. PRs target `develop` and carry `Closes #<n>`.
- Every number you write down came from a command whose output you read (`docs/SPEC.md` §7.7).
- Verify before claiming: skill `verifying-changes` is the ladder; `docs/SPEC.md` §7 is done.

## Ask First

- Adding, removing or upgrading a dependency (`docs/SPEC.md` §3 freeze).
- A schema migration, or any change to auth, sessions, tenant scoping, billing or the ledger.
- Anything that widens the accessibility claim (`docs/ACCESSIBILITY.md`).
- Deleting a test, or narrowing what a test asserts.
- A change to a surface listed in `BACKWARD_COMPATIBILITY.md`.

## Never

- Float arithmetic on an amount, at any layer, including a chart label or a tooltip.
- SQL outside `src/server/repos`; a direct write to `account_balances` outside `src/server/ledger`.
- A bank connector, an aggregator or credential capture for a financial institution (ADR 0008).
- Copying a string, a name, a number or a layout from the reference product: the clean-room rule
  in `docs/agents/reference.md`.
- `--no-verify`; a force-push to `develop` or `main`; a hand edit to a generated file.
- Adding `@ts-ignore`, `@ts-expect-error` or `eslint-disable`; `.skip`, `.only`, `.todo` or
  `.fixme` on a test; deleting a test file to make a gate green.
- Hardcoded user-facing copy; an `if (n === 1)` plural; `Intl.DisplayNames` in `src/lib/i18n`.
- Reading `.dev.vars`, `.env.local` or `.ai/qa/test-env.env`.
- A blanket "WCAG AAA" claim anywhere: copy, comment, commit message or plan.
- A PNG or a report left inside the repository; frames go to `.ai/qa/artifacts_*/` or a scratchpad.

## Validation Commands

**The gate is `validation.commands` in `.ai/agentic.config.json`, in the order written there.** Read
it and run it; this file deliberately does not copy the list, because the copy that used to live
here had already fallen out of step with it once, and an agent that ran the stale copy failed the
gate in CI on a command it never ran.

```bash
node -e "require('./.ai/agentic.config.json').validation.commands.forEach(c=>console.log(c))"
```

`pnpm e2e` is not in the gate because it needs a running environment: CI runs it on every pull
request, and `om-auto-qa-pr` drives the app for UI evidence. `pnpm check` (prettier over the whole
repo) is not a gate either; keep what you touch prettier-clean.

The gate starts with the two generated-file checks for a reason: `src/routeTree.gen.ts` and
`drizzle/` are regenerated and diffed, so a hand edit to either is caught in the first seconds of a
run rather than in review.

Every file in this repository is yours to edit. `.ai/cezar/workflows/`, `.ai/cezar/config.json`,
`.ai/skills/afk-*/`, `.claude/hooks/`, `.claude/settings.json`, `.claude/skills/backlog/SKILL.md`,
`.ai/trackers/github.md`, `scripts/ci/` and the Claude `.github/workflows/` used to be rendered from
`design4pro/agent-kit` and could not be; that repository is retired and they are ordinary files
(ADR 0021). They are still in `.prettierignore`, so keep the formatting you find.

## Task Router

| When the task involves…                        | Read first                                                                                                                             | Key rules                                                                                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A word you are not sure of                     | `CONTEXT.md`                                                                                                                           | A glossary and nothing else; the `_Avoid_` clause is the load-bearing part                                                                                                                                                  |
| An amount, a rate, a currency or a date bucket | `docs/MONEY.md` in full                                                                                                                | Cite section numbers; never restate the arithmetic                                                                                                                                                                          |
| A query, a repository, a migration             | `docs/SPEC.md` §5.2, §6.1; ADR 0002; `src/server/repos/scope.ts`                                                                       | `TenantScope` first parameter; additive migrations; tenant-isolation case                                                                                                                                                   |
| Balances, transfers, the ledger                | `docs/MONEY.md` §4; ADR 0010; `src/server/ledger/`                                                                                     | Rebuilt wholesale through `LEDGER`, never accumulated                                                                                                                                                                       |
| A server function or an API route              | `docs/SPEC.md` §5.1, §6.1; `src/server/fns/`                                                                                           | Zod twice; permission server-side; slow work on `TASKS`                                                                                                                                                                     |
| Auth, sessions, invitations, roles             | ADR 0011; `docs/SPEC.md` §5.3; `src/server/auth/`                                                                                      | Two role dictionaries; `beforeLoad` is UX                                                                                                                                                                                   |
| Billing, plans, quotas                         | ADR 0012; `docs/SPEC.md` §5.4; `docs/plans/22-billing.md`; `src/lib/plans.ts`                                                          | One catalogue, one resolver (SPEC §8); webhook work runs on the queue                                                                                                                                                       |
| A component or a screen                        | `DESIGN.md`; `docs/SPEC.md` §2, §4; `src/components/ui/`                                                                               | React Aria primitives; states; keyboard path; text table beside every chart                                                                                                                                                 |
| User-facing copy                               | skill `i18n-messages`; `docs/I18N.md`                                                                                                  | EN + PL in the same change; plural machinery; keys in stored rows                                                                                                                                                           |
| Accessibility                                  | `docs/ACCESSIBILITY.md`; `docs/SPEC.md` §10                                                                                            | AA is the gate; five named AAA criteria; never a wider claim                                                                                                                                                                |
| A chart                                        | ADR 0007; `DESIGN.md` → Charts                                                                                                         | Hand-rolled; visually-hidden data table; non-colour encoding                                                                                                                                                                |
| CSV, OFX, QIF import                           | `src/server/import/`; `docs/plans/`                                                                                                    | Widen before narrowing; presets are stored rows                                                                                                                                                                             |
| Tests                                          | skill `tdd`; skill `verifying-changes`; `vitest.config.ts`; `e2e/support/`                                                             | Failing test first; workerd project for Worker code (ADR 0015); console red fails a browser run                                                                                                                             |
| Verifying a change, a confusing failure        | skill `verifying-changes`                                                                                                              | Re-run failed files alone; a timeout is a claim about the machine until the text says otherwise                                                                                                                             |
| Visual verification                            | ADR 0016; `scripts/visual/capture.mjs`                                                                                                 | Light + dark, 360 + 1280, the interaction state; frames outside the repository                                                                                                                                              |
| Background work, cron, email                   | `src/server/queue/`, `src/server/cron/`, `src/server/email/`; `wrangler.jsonc`                                                         | Idempotent handlers; one `kind` per job; keys not sentences in envelopes                                                                                                                                                    |
| Bindings, secrets, deploys                     | `wrangler.jsonc`; `docs/DEPLOY.md`; `docs/SECURITY.md`; `.dev.vars.example`                                                            | Append-only DO migrations; never a secret in a log or a PR                                                                                                                                                                  |
| A new feature or area                          | `docs/plans/README.md` and the area's plan; `docs/agents/out-of-scope.md`                                                              | Plans are the backlog source; a rejected request is not re-litigated                                                                                                                                                        |
| A specification: writing, finding or retiring  | `.ai/specs/AGENTS.md`; `.ai/specs/README.md`                                                                                           | The directory is the status; the table names issue and PRs; the index is generated                                                                                                                                          |
| A product decision                             | `docs/adr/`                                                                                                                            | One ADR per decision; amend rather than rewrite                                                                                                                                                                             |
| Comparing against the reference product        | `docs/agents/reference.md`                                                                                                             | Rendered pixels only; nothing else crosses                                                                                                                                                                                  |
| Working while someone else edits the checkout  | `docs/agents/shared-checkout.md`                                                                                                       | 3010 is the developer's port; agents take 3011-3020                                                                                                                                                                         |
| The delivery process, labels, QA gate          | `SDLC.md`; `CODE_REVIEW.md`; `BACKWARD_COMPATIBILITY.md`; `docs/agents/issue-tracker.md`                                               | Labels are the state machine; `needs-qa` needs a human's `qa-approved`                                                                                                                                                      |
| Unattended intake: triage, tickets, lessons    | `SDLC.md` § Intake labels, § Trigger labels, § Unattended decisions; `.ai/skills/afk-*/SKILL.md`; `docs/agents/cezar-automations.json` | Two ladders: `autofix` is a human's lever, `needs-triage` → `ready-for-agent` is the pipeline's own. Every decision goes in a Resolved assumptions table. Nothing merges; `risk-high` and `security` are excluded by filter |
| The orchestrator                               | `docs/agents/cezar.md`; ADR 0013, ADR 0017                                                                                             | One cockpit per host; no secrets in the service env                                                                                                                                                                         |

## Process and skills

- The pipeline is the `om-*` skill collection, vendored in `.claude/skills/om-*` at the SHA recorded
  in `skills-lock.json` (`pnpm install-skills` refreshes it; the lock moves in the same commit) and
  configured by `.ai/agentic.config.json`. Tracker operations are
  defined in `.ai/trackers/github.md`, browser operations in `.ai/browsers/playwright.md`.
- Repo-specific rules for a skill live in `.ai/skills/om-<name>/SKILL.md` and extend the installed
  skill; they never relax its safety rules.
- Repo-local skills: `verifying-changes`, `i18n-messages`, `tdd` (`.claude/skills/`).
- The `afk-*` skills under `.ai/skills/` run the unattended intake ladder: `afk-triage` (one issue
  to an Agent Brief and one intake label), `afk-to-tickets` (a merged spec to tracer-bullet
  tickets), `afk-architecture-review` (weekly), `afk-lessons` (weekly), `afk-domain-modeling`
  (`CONTEXT.md` and ADR discipline) and `afk-codebase-design` (the design vocabulary — module,
  interface, depth, seam, adapter, the deletion test). **None of them is installed as a skill**, so
  read the file at `.ai/skills/<name>/SKILL.md`; the `Skill` tool cannot reach it and answers
  `Unknown skill`. All six were rendered by `design4pro/agent-kit`; since ADR 0021 they are
  ordinary files, edited here.
- `afk-codebase-design` comes in two halves. `.ai/skills/afk-codebase-design/SKILL.md` is the shared
  one: the vocabulary and the rules, which `afk-triage`, `afk-to-tickets` and
  `afk-architecture-review` all read by that literal path. This repository's house idiom, seam
  table, dependency examples, test layout and risk-high interfaces are the other half, at
  `.ai/cezar/skills/afk-codebase-design/SKILL.md`, which shadows the first by name because
  `.ai/cezar/skills` is scanned first. Read both.
- `SDLC.md` is the ticket flow, `CODE_REVIEW.md` the review rules, `BACKWARD_COMPATIBILITY.md` the
  protected surfaces, `.ai/review-checklist.md` the per-PR list.
