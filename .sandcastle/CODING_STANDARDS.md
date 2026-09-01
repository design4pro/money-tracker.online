# Coding standards (pushed to the reviewer)

Distilled from docs/SPEC.md §6–§7. The repo overrides this file where they disagree.

## Layering (contract, not style)

- All SQL lives in `src/server/repos` and goes through the tenant-scoped base repository. The tenant predicate must not be removable. `src/server/catalog` is the only carve-out (currencies, exchange rates, brand logos), guarded by `requirePermission` + platform audit log.
- Routes call server functions (`src/server/fns` or a route-local `-server/`); server functions call repos. No SQL anywhere else.
- Money never leaves the integer minor-unit representation. No float arithmetic on an amount, ever, at any layer. Formatting is the only place a decimal appears, and it goes through `src/lib/money.ts` using `currencies.digits`.
- Every amount that crosses the base-currency boundary carries its `rate_e10` and its ref amount. A report that recomputes a historical conversion is a defect.
- Balance history is rebuilt wholesale, never accumulated, and always through the LEDGER Durable Object. A direct write to `account_balances` outside `src/server/ledger` is a defect.
- `components/ui` never fetches data and never imports from `server/`.
- Every server-function input is validated with Zod, and parsed a second time in the repository.
- Generated files are never hand-edited: `src/routeTree.gen.ts` (`pnpm generate-routes`), `drizzle/` (`pnpm db:generate`).
- Migrations are additive; the running Worker must survive the migrate-then-deploy window.

## Style

- TypeScript strict. No `any`, no non-null `!` on values that can genuinely be null.
- Named exports, no default exports (route modules excepted — TanStack requires them).
- `cn()` for class merging.
- No nested ternaries — prefer switch or if/else chains. Clarity over brevity.
- No TODOs, placeholder copy, `console.log`, or commented-out code left behind.

## Tests

- New logic has tests, written at the seams the ticket names — not implementation-coupled, not tautological.
- The tenant boundary is the primary test surface: any new tenant-scoped data path needs a tenant-isolation case.
- The money boundary is a test surface equal to the tenant boundary — every new write path that touches an amount needs a case in `src/server/repos/__tests__/money-invariants.test.ts`.

## Commits

- Conventional Commits, in English (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`). The `RALPH:` prefix is reserved for sandcastle in-loop commits.

## Smell baseline (judgement calls)

A fixed set of Fowler smells (_Refactoring_, ch.3) that applies on top of everything
above. Two rules bind it:

- **The repo overrides.** A documented standard in this file always wins; where it
  endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each entry is a labelled heuristic ("possible Feature
  Envy"), never a hard violation — unlike the layering contract, which is. Skip anything
  `pnpm lint` already enforces.

Each reads _what it is_ → _how to fix_:

- **Mysterious Name** — a function, variable or type whose name does not reveal what it
  does or holds. → Rename it; if no honest name comes, the design is murky.
- **Duplicated Code** — the same logic shape in more than one hunk or file. → Extract the
  shared shape, call it from both.
- **Feature Envy** — a function reaching into another module's data more than its own. →
  Move it onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together. → Bundle them
  into one type and pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that
  deserves its own type. → Give the concept its own small type. (CONTEXT.md names the
  concepts that qualify.)
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs. →
  Replace with a typed map or dispatcher both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files. →
  Gather what changes together into one module.
- **Divergent Change** — one file is edited for several unrelated reasons. → Split so
  each module changes for one reason.
- **Speculative Generality** — abstraction, params or hooks added for needs the ticket
  does not have. → Delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller should not depend on. →
  Hide the walk behind one method on the first object.
- **Middle Man** — a module that mostly just delegates onward. → Cut it, call the real
  target directly.
- **Refused Bequest** — an implementer that ignores or overrides most of what it
  inherits. → Drop the inheritance, use composition.
