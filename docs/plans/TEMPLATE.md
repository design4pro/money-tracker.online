# Stage template

Every plan file in `docs/plans/` is a sequence of stage blocks in this exact shape. Copy the block at
the end of this file, fill every heading, delete nothing. The headings are the contract between a
plan and the agent that executes it: an orchestrator reads **Owned paths** to fan out without
collisions, and an auditor reads **Definition of done** to decide whether the stage closed.

Read `docs/SPEC.md`, `docs/MONEY.md`, `DESIGN.md` and `docs/ARCHITECTURE.md` before writing a stage.
This file does not restate them; it says where each of their requirements is answered.

## How a plan file is shaped

A plan file opens with a short **Area brief** — what this area is, which rows it closes, and what it
deliberately leaves to another plan — and then runs stage blocks in wave order, lowest wave first.
Nothing else. No appendices, no glossary, no status log; the wave order lives in `README.md`.

## Rules that bind every stage

- **The twelve `###` headings below are required, in that order, and no others appear at that
  level.** A stage with nothing to say under a heading writes one sentence saying so and why —
  "No new countable row: this stage only edits existing rows" is an answer. **An empty heading is
  not.**
- **Owned paths are disjoint.** Two stages in the same wave may not name the same file. None of the
  eight shared paths governed by `00-foundations.md` may be named at all — see `README.md`.
- **Owned paths are written as `` `path` — new|edit `` bullets, never as a table.** The collision
  checker parses that exact shape.
- **The clean-room rule of `docs/SPEC.md` §1 applies to every word of a stage.** The reference
  product is never named and nothing is carried across from it.
- **A finished stage carries one `Delivered:` line.** When the code already delivers a stage,
  `afk-plan-to-spec` adds `Delivered: <YYYY-MM-DD> - <evidence: the paths, tests or PR>` directly under its
  `## Stage` heading. It is not a `###` heading and it is the only status a plan records;
  `backlog-status.mjs --plan` skips a stage that has one. A stage delivered in part has none.
- **The stage is the unit of ownership, the run is not.** A stage that cannot be finished by one
  agent in one run is two stages.
- **`### Money invariant` is mandatory and is never skipped.** In this product the arithmetic
  boundary is exactly as load-bearing as the tenant boundary, and a heading that can be skipped is a
  heading that will be. A stage that genuinely touches no amount writes one sentence saying so and
  naming what it does touch instead.

---

## Stage block — copy from here

### Stage id

`<NN>-S<k>` where `<NN>` is the plan's ordinal and `<k>` counts stages within it, e.g. `07-S2`. One
line, then a title, the wave the stage may start in, and an effort roll-up (S/M/L/XL) taken from the
rows it closes.

### Reference rows

The row ids this stage closes, one per line, each with the status it moves **from** and **to** —
`TXN-04 missing → done`. Row ids are minted in this plan set (`README.md` → _Row ids_) and are the
preferred way for one plan to point at a feature owned by another. A row is closed by exactly one
stage. If a row is only partly addressed, say which behaviour is deferred and to which stage id;
"partial → partial" that nobody has to justify is how a matrix stops meaning anything.

### Owned paths

Every file the stage creates or edits, as `` `path` — new `` or `` `path` — edit `` bullets. No
globs that could widen under a later refactor, except a `__tests__` directory the stage owns wholly.
One further glob is sanctioned by name and by nobody else: `src/components/ui/**`, which `00-S6`
owns as a shared path (`README.md` → _The eight shared paths_). The drift guard resolves it to its
base directory and asserts that the directory exists; it never expands it, because expanding a
shared path would fail every time a primitive is legitimately added.

**A generated filename never appears under this heading.** `src/routeTree.gen.ts` is already
excluded by name (`README.md`); a `drizzle/*.sql` migration is excluded for the same reason and
this sentence says so, because the exclusion was previously only implied. Say what the migration
creates and what it backfills under _Data and migration_ instead. A stage that names one is
asserting control over a string its generator owns, and the requirement is unenforceable however
carefully it is written.

This list is the fan-out contract: an auditor diffs the stage's actual changes against it, and a
path outside it is a failure **even if the code is correct**.

If the stage needs a change to a shared path, it does **not** appear here. State the requirement
under the relevant heading below so it becomes a wave-0 stage in `00-foundations.md`.

### Data and migration

Tables and columns the stage needs, and for each whether it already exists in
`src/server/db/schema.ts`.

- Schema changes are **additive only** (`docs/ARCHITECTURE.md` §9): a rollback must keep working
  against the new schema. No column is dropped, renamed or narrowed in the same stage that stops
  writing it.
- The schema edit itself belongs to `00-foundations.md`. This section states the **requirement**:
  table, column, type, nullability, default, the `CHECK` constraint for any enum, and the leading
  `organization_id` position in every new composite index.
- State that `pnpm db:generate` produces exactly one new file under `drizzle/`, name the tables and
  columns it creates, and say what it backfills or that it backfills nothing. Do **not** name the
  file: Drizzle chooses that name, so a stage asserting it is asserting something it does not
  control. The filename never appears under _Owned paths_ either — see that heading.
- Money is `integer` minor units plus a `text(3)` ISO-4217 code; rates are `rate_e10` integers;
  calendar dates are `YYYY-MM-DD` text, times `HH:MM` text, instants epoch milliseconds; ids come
  from `newId()`. Do not invent a second convention.

### Server (repo, server function, Zod)

- **Repository.** The module under `src/server/repos/` and the exported functions the stage adds or
  changes. SQL lives here and nowhere else. Every query is built on `tenantFilter()`; a repository
  callable without a `TenantScope` is malformed.
- **Server function.** Each `createServerFn({ method })` the stage exposes, its file under
  `src/server/fns/` or a route-local `-server/` directory, and what it returns.
- **Zod.** The v4 schema for every input — `z.strictObject()`, `z.iso.date()`, the `error` parameter.
  Validation is shape, never permission. The input is parsed a **second** time in the repository.
- **Authorisation.** Say explicitly where it is decided. A server function is a public endpoint
  reachable without the route that renders its UI; `beforeLoad` is UX, never a data boundary. A
  well-formed id from the client is not an authorised id.
- **Ledger batching.** If the stage writes anything that changes an account's balance or history, it
  runs inside `runWithLedgerBatch` at the outermost boundary. Say so.
- Anything slow — import, export, email, backup, rebuild, fan-out — is enqueued on `TASKS`, never
  run inline.

### UI (route, components)

- **Route.** The path and file. A new route file means `pnpm generate-routes`; `src/routeTree.gen.ts`
  is never hand-edited and never listed under Owned paths. Say whether the route is SSR,
  `ssr: false` or `ssr: 'data-only'`, and why if it is not the default.
- **Components.** Which existing primitives from `src/components/ui` are reused — name them, because
  a second implementation of an existing primitive is a defect — and which new product components
  the stage adds, under `src/components/<module>/` or a route-local `-ui/` directory.
- **States.** For each list and async surface, name the empty state's copy, the skeleton's shape, and
  the error state's recovery affordance. "Has an empty state" is not a plan.
- **Tokens.** Any colour, spacing, radius, shadow, easing or z-index the stage needs that is not
  already in `src/styles/tokens.css` is a foundations requirement, stated here. No hard-coded hex, no
  one-off margin, `tabular-nums` on every number that can change, end-aligned amount columns.
- **Accessibility.** Name the keyboard path for any drag affordance, the text equivalent for any
  chart, and the second channel beside any colour-encoded meaning.

### Quota

Which metric this stage's writes consume, and where the ceiling is asserted.

- If the stage creates a row a plan can run out of, name the metric, say whether it already exists in
  `resolveLimits()` (`src/server/billing/limits.ts`) and in the catalogue (`src/lib/plans.ts`), and
  name the `assertWithinLimit(scope, metric, requested)` call site — **inside the repository, before
  the write**.
- The published number is the enforced number. A metric added to the catalogue and not to the
  resolver is caught by `src/server/billing/__tests__/limits.test.ts`; a stage that adds one adds the
  case there too.
- For R2 writes the order is **object first, assert second, compensating delete on throw**.
- If the stage creates no countable row, say so in one sentence and why.

### Tenant isolation test

The case added to `src/server/repos/__tests__/tenant-isolation.test.ts`: workspace A asks, **in A's
scope**, to read, list, update and delete B's new rows by id, and to parent new rows onto B's rows.
Every one must be a `NotFoundError`, and B's data must be untouched afterwards. Name the repository
functions covered.

**A stage that adds a repository function and no isolation case is not done.**

### Money invariant

**Mandatory.** Name the arithmetic property this stage must not break, and the test that holds it.

Examples of a real answer: "`Σ splits.amount_minor = parent.amount_minor` for every split write, held
by `money-invariants.test.ts` → _splits sum to parent_" · "an internal transfer nets to zero in base
currency whenever either leg is in base" · "`ref_amount_minor` is written once at `booked_on`'s rate
and no read path recomputes it" · "no float touches an amount on this path, including the chart
datum and the tooltip" · "day bucketing is UTC on the snapshot grid and `booked_on` is the person's
chosen calendar date".

Name the test file and the case name. The default file is
`src/server/repos/__tests__/money-invariants.test.ts`; a stage using another says which and why.

A stage that genuinely touches no amount, rate, currency or date bucket writes one sentence saying
so and naming what it does touch instead — that is an answer. Silence is not.

### Verification

- The command gate, in this order: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- The unit tests the stage adds, by file, and what invariant each holds.
- The browser evidence: route, both themes, at **360px, 1280px and 2560px**, plus the interaction
  state that is the point of the stage — a resting screenshot is not evidence about a hover
  affordance. `98-verification-protocol.md` owns the evidence format; this section names the specific
  screens and states, not the procedure.
- The `@axe-core/playwright` run on the stage's routes, asserting zero `serious` and zero `critical`
  violations, with any `moderate` waiver named and justified **here**.
- Console must be silent. A warning in the console is this stage's bug.

### Definition of done

The seven repository-wide items from `docs/SPEC.md` §7 apply to every stage without amendment:

1. `pnpm build` succeeds.
2. `pnpm lint` and `pnpm typecheck` are clean — no new errors, no suppressions.
3. New logic has tests; `pnpm test` passes.
4. The feature is visually verified in a real browser, light and dark, desktop and mobile.
5. No TODOs, no placeholder copy, no `console.log`, no commented-out code left behind.
6. You did not touch files outside your assigned ownership.
7. Every number you write down was produced by a command, not by an impression, no claim of yours
   got stronger without a new measurement, and you confirmed what each command was aimed at before
   you read what it returned.

On top of those, the ten clauses of `docs/SPEC.md` §2 are ticked per surface the stage ships:

- [ ] Spacing on the 4px grid, from `--space-*`. No eyeballed one-off margins.
- [ ] Every interactive element has hover, focus-visible, active, disabled and loading states, and a
      44×44 CSS px hit area.
- [ ] Every list has a designed empty state, a skeleton loading state and an error state.
- [ ] Motion is 150–260ms on a token easing, transform and opacity only, and
      `prefers-reduced-motion: reduce` is honoured.
- [ ] Full parity in light **and** dark theme, with dark shadows re-declared rather than reused.
- [ ] Responsive 360px → 2560px, where the small layout is designed and not a squeezed desktop.
- [ ] Keyboard navigable end to end, sensible focus order, accessible names, and a non-drag path
      beside every drag affordance.
- [ ] Every number that can change is `tabular-nums`; every amount column is end-aligned.
- [ ] Every chart ships a visually-hidden data table, keyboard-reachable points and a non-colour
      encoding.
- [ ] Zero console errors or warnings, zero layout shift after paint, and a clean axe run.

A stage with an unticked box is not done, and neither is one that ticks a box it did not look at.

### Blockers

Anything that stops the stage, stated before it is scheduled rather than discovered mid-run:

- **A package outside the `docs/SPEC.md` §3 pinned set.** Record the package, what it would do, and
  the disposition: **defer** (wait for a decision), **substitute** (a named platform capability that
  covers it), **hand-roll** (scope and risk of writing it ourselves), or **drop** (the row moves to
  `99-boundaries-and-blockers.md`). Never plan as though the package were present, and never install
  one — the freeze covers `package.json` and `pnpm-lock.yaml` absolutely.
- **A binding absent from `wrangler.jsonc`**, which is a foundations requirement and a cost-model
  change.
- **A product decision that is not yet made.** `PRODUCT.md` → _Undecided_ lists the open ones; cite
  the item rather than choosing silently.
- **A dependency on a row in another plan that has not landed.** Cite the row id and its wave.

If there are none, write "None." — and mean it.
