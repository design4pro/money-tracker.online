# Contributing

This repository is worked by humans and by agents, under the same rules. Nothing below is softer
for one than for the other.

## Before you write anything

1. Read `CLAUDE.md`. It is the shortest file here and it points at everything else.
2. Read the section of `docs/SPEC.md` your change lands in. `docs/SPEC.md` §7 is the definition of
   done and §8 is the decomposition rule; both are inherited by every task without amendment.
3. If your change touches an amount, a rate, a currency or a date bucket, read `docs/MONEY.md`
   **in full** first. It is the one document in this repository where being approximately right is
   indistinguishable from being wrong.
4. If your change adds a user-facing string, read `docs/I18N.md` §2.

## The loop

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
# … change something …
pnpm lint && pnpm typecheck && pnpm test
```

Those three commands are the gate. `pnpm build` is the fourth rung and CI runs it on every pull
request; run it locally before opening one if you touched the Worker entry, the route tree, Vite
config or anything under `src/server/`.

## Branches and commits

- Cut from `develop`. Never commit to `develop` or `main` directly.
- Branch names: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `claude/<slug>`.
- **Conventional Commits, in English**, always: `feat(transactions): add split editor`. The scope
  is the plan area or the module, not a file name.
- One pull request targets `develop`. Promotion to production is a separate pull request
  `develop` → `main`, opened by whoever is releasing.
- A pull request body says what changed and what was verified. "Verified" means a command you ran
  and its result, or a screenshot at a named viewport and theme — not "looks fine".

## The rules that get changes rejected

These are not style preferences. Each one has a failure mode behind it.

1. **A float touched an amount.** Any float arithmetic on money, at any layer, including a tooltip
   or a chart label. Amounts are integer minor units; the scale is `currencies.digits` and never a
   hard-coded 2. See `docs/MONEY.md` §1.
2. **A recomputed historical conversion.** `ref_amount_minor` is written once at the booked date's
   rate and never recalculated. A report that re-derives one is a defect. `docs/MONEY.md` §3.
3. **SQL outside `src/server/repos`.** All data access goes through the tenant-scoped repository.
   `src/server/catalog` is the single stated exception, guarded by `requirePermission` plus a
   platform audit-log write. `docs/adr/0002-tenant-scoped-repository-boundary.md`.
4. **A repository function with no tenant-isolation test.** A new read or write path in a repo
   module ships with its case in `src/server/repos/__tests__/tenant-isolation.test.ts`.
5. **A write path that touches an amount with no money-invariant test.** The money boundary is a
   test surface equal to the tenant boundary; the case goes in
   `src/server/repos/__tests__/money-invariants.test.ts`.
6. **A hand edit to a generated file.** `src/routeTree.gen.ts` (`pnpm generate-routes`) and
   anything under `drizzle/` (`pnpm db:generate`). CI diffs both and fails on drift.
7. **A new dependency.** The dependency set is frozen (`docs/SPEC.md` §3). A package need is
   recorded as a **Blockers** entry on the relevant plan stage with a disposition — defer,
   substitute, hand-roll or drop — never installed as part of the change that wanted it.
8. **A hardcoded user-facing string.** Copy lives in the catalogue, and a new key lands in **both**
   EN and PL in the same change. The parity test enforces it.
9. **A drag-and-drop surface with no keyboard path.** Every reorder, move or assign that can be
   done by dragging also has a menu control that does the same thing with a keyboard, shipped in
   the same change.
10. **A chart without a text equivalent.** Every chart ships a visually-hidden data table,
    keyboard-reachable points, and a non-colour encoding. `DESIGN.md` → Charts.
11. **Colour as the only channel.** A status, a series, a direction or a category identified only
    by its colour. `DESIGN.md` → The Colour-Is-Never-Alone Rule.
12. **An accessibility claim broader than `docs/ACCESSIBILITY.md`.** No copy, comment, commit
    message or marketing string may say "WCAG AAA compliant" or anything that implies it.
13. **A bank connector, an aggregator, or credential capture for a financial institution.**
    Permanently out of scope. `docs/adr/0008-no-bank-connectors.md`.
14. **Files touched outside your assignment.** In an agent run this is a hard failure even when the
    code is correct: the orchestrator fans out on **Owned paths** and an out-of-list write corrupts
    a sibling's diff.

## Accessibility is part of the change, not a follow-up

Every surface you ship owes, in the same pull request:

- Keyboard reachability end to end, with a sensible focus order and accessible names.
- Hover, focus-visible, active, disabled and loading states on every interactive element.
- A designed empty state, a skeleton and an error state on every list and async surface.
- Light **and** dark parity, with dark shadows re-declared rather than reused.
- 360px → 2560px as designed layouts.
- A 44×44 CSS px hit area on everything interactive.
- `prefers-reduced-motion: reduce` honoured.
- Zero console errors or warnings, and zero layout shift after paint.
- A clean `@axe-core/playwright` run at the configured rule set — no `serious`, no `critical`, and
  any `moderate` waiver named and justified in the pull request.

## Tests

- **Unit and repository tests** with Vitest. A pure function gets a unit test; a repository function
  gets a tenant-isolation case; a money-touching write gets a money-invariant case.
- **e2e and visual** with Playwright. A module adds `e2e/<module>.visual.spec.ts` and never appends
  to a shared spec — baseline collisions are prevented mechanically by the snapshot path template.
- `maxDiffPixelRatio: 0.002` and `threshold: 0.2` are **never raised** — not globally, not per
  project, not per call. That budget exists for cross-platform font antialiasing and nothing else.
  The two legal remedies for a failing diff are pinning the renderer or fixing the source of the
  difference.
- Screenshot baselines are per platform. `-darwin` is recorded locally with `pnpm e2e:update`;
  `-linux` is recorded through the **Update e2e baselines** workflow, which opens a reviewable
  pull request.

## Working on the backlog

The backlog is GitHub Issues on `design4pro/money-tracker.online`. A PRD is a parent issue and its
sub-issues are vertical slices in execution order. `ready-for-agent` is a per-slice gate and is
never applied to a PRD. Ticket bodies must not contain `Closes #n` — closing is the merger's job.
Full contract: `docs/agents/issue-tracker.md`; labels: `docs/agents/triage-labels.md`.

The staged plan set in `docs/plans/` is where a slice's scope comes from. If you are implementing a
stage, its **Owned paths** list is your whole permitted diff, and its **Verification** block is what
you have to leave behind.

## Reporting a security issue

Do not open a public issue. See `docs/SECURITY.md` → _Reporting_.
