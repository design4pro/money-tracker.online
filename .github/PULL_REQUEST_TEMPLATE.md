<!--
Conventional Commits in the title, in English: feat(transactions): …, fix(budgets): …,
chore(deps): … . An om-* run follows the same convention (`fix(area): … (#n)`).
-->

## What changed

<!--
One paragraph. What a reviewer needs to know before reading a diff, not a restatement of it.
`Closes #n` is required: merging to `develop` does not close an issue natively, and
`om-close-fixed-issues` closes exactly the issues this line names.
-->

Closes #

## Why

<!-- The behaviour that was wrong or missing. If this is a bug fix, the failing case. -->

## Verification

<!--
Paste what you ran, not what you intend to run. The ladder is the same one CI runs, in the same
order - so a green local run is a green CI unless something
has drifted.
-->

- [ ] `pnpm generate-routes` leaves `src/routeTree.gen.ts` unchanged
- [ ] `pnpm db:generate` leaves `drizzle/` unchanged, or the new migration is committed with it
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm e2e` (CI runs it too, unless nothing in the diff reaches the browser)

## Invariants

<!-- Delete the lines that this change cannot touch. Do not delete a line to make it go away. -->

- [ ] **Tenant isolation** — every new query goes through the tenant-scoped repository, and the
      predicate is not removable. New write paths have a case in
      `src/server/repos/__tests__/tenant-isolation.test.ts`.
- [ ] **Money** — no float arithmetic on an amount at any layer. Every amount crossing the
      base-currency boundary carries its `rate_e10` and its ref amount. New write paths that
      touch an amount have a case in `src/server/repos/__tests__/money-invariants.test.ts`.
- [ ] **Balances** — rebuilt wholesale through the `LEDGER` Durable Object, never accumulated,
      never written directly.
- [ ] **Migrations are additive** — the running Worker survives the migrate-then-deploy window.
      A removal or a narrowing is two releases, not one.
- [ ] **Accessibility** — keyboard reachable, visible focus, labelled controls, 44px targets. The
      a11y workflow's A/AA gate is green.
- [ ] **i18n** — every new string exists in both `en` and `pl`.

## Visual change

<!--
If this changes rendered output on purpose, say so here, and name the screens.
Nothing in CI photographs a screen any more (docs/adr/0016-journeys-replace-the-visual-gate.md),
so this section is not paperwork about a diff somebody will see anyway - it is the only notice a
reviewer gets. Take the blind pair yourself over the affected screens:
  node scripts/visual/capture.mjs --url ... --out <scratchpad>/... --viewports 360x800,1280x900
and say which screens you shot. Frames belong outside the repository.
-->

- [ ] No visual change
- [ ] Visual change is intended, declared in the ticket's `## Visual change expected`, pair captured

## QA routing

<!--
One label, per SDLC.md: `needs-qa` when the change touches a screen (src/routes, src/components,
styles, copy), `skip-qa` when it cannot. `needs-qa` without `qa-approved` never merges, and only a
human sets `qa-approved`; `om-auto-qa-pr` posts evidence, it does not approve.
-->

- [ ] `needs-qa` - a screen changed; QA evidence and a human's `qa-approved` before merge
- [ ] `skip-qa` - no screen changed

## Risk

<!--
Anything a reviewer should look at twice: a data migration, a change to auth, billing, the ledger,
or an import path. "None" is a valid answer when it is true.
-->
