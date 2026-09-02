<!--
Conventional Commits in the title, in English: feat(transactions): …, fix(budgets): …,
chore(deps): … . An in-loop agent commit is prefixed `RALPH:` instead; the pull request title
still follows Conventional Commits.
-->

## What changed

<!-- One paragraph. What a reviewer needs to know before reading a diff, not a restatement of it. -->

Closes #

## Why

<!-- The behaviour that was wrong or missing. If this is a bug fix, the failing case. -->

## Verification

<!--
Paste what you ran, not what you intend to run. The ladder is the same one CI runs, in the same
order, and `.sandcastle/validate.sh` runs it too - so a green loop is a green CI unless something
has drifted.
-->

- [ ] `pnpm generate-routes` leaves `src/routeTree.gen.ts` unchanged
- [ ] `pnpm db:generate` leaves `drizzle/` unchanged, or the new migration is committed with it
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm e2e` (or the `needs-e2e` label, so CI runs it)

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
If this changes rendered output on purpose, say so here AND add the `visual-change-expected`
label - that label is what tells the loop a screenshot diff is intended rather than a regression.
Refresh the baselines with `pnpm sandcastle:baselines` or the "Update e2e baselines" workflow.
There is one set and it is `-linux`, because Linux is what the gate runs on; `pnpm e2e:update` on
a Mac records nothing, because the frames skip off Linux.
-->

- [ ] No visual change
- [ ] Visual change is intended, `visual-change-expected` label added, baselines refreshed

## Risk

<!--
Anything a reviewer should look at twice: a data migration, a change to auth, billing, the ledger,
or an import path. "None" is a valid answer when it is true.
-->
