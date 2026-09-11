# 01 — Design system

## Area brief

The visual and interaction contract: the Tailwind 4 theme layer, the palette that carries the 7:1
body/UI floor of `DESIGN.md`, the React Aria primitive inventory, the state matrix every interactive
element owes, and the motion contract.

**This plan specifies; `00-foundations.md` writes the shared files.** `src/styles/tokens.css` and
`src/components/ui/**` are shared paths (`README.md` → _The eight shared paths_). This plan's stages
own the theme layer, the gallery route that makes the primitives visible, the contrast and state
tests, and the inventory — and they **requisition** `00-S3` (tokens), `00-S6`, `00-S8`, `00-S10`,
`00-S13` and `00-S16` (primitives). A stage here that lists a shared path is malformed.

What this plan does **not** own: the chart primitives' behaviour (plan `16` specifies them; `00-S10`
frames them), the marketing type scale beyond the shared tokens (plan `25`), and the 360px layouts of
individual product surfaces (each owning plan, plus plan `27`).

---

## Stage 01-S1 — The theme layer, the gallery and the state matrix

### Stage id

`01-S1` · Wave 1 · effort **L**. The Tailwind 4 theme, the primitive gallery route, and the tests
that make "every interactive element has five states" falsifiable.

### Reference rows

`DSY-01 missing → done` — the Tailwind 4 `@theme` layer is declared in `src/styles/app.css` and maps
the `00-S3` tokens to utilities. Held in one direction only, by
`src/styles/__tests__/token-classes.test.ts`: every token-shaped class in `src/` resolves to a
registered token. The converse — every registered token is reachable as a utility, which is what
_maps every token_ claims — is asserted by nothing (#217).
`DSY-02 missing → missing` — the primitive gallery route renders every primitive in every state.
`src/routes/_dev/` does not exist, so neither the route nor its two components do.
`DSY-03 missing → missing` — the state-matrix test.
`src/components/__tests__/state-matrix.test.tsx` is absent; issue #21 is what its absence costs.

### Owned paths

- `src/styles/app.css` — edit
- `src/routes/_dev/gallery.tsx` — new
- `src/routes/_dev/-ui/state-grid.tsx` — new
- `src/routes/_dev/-ui/token-sheet.tsx` — new
- `src/components/__tests__/state-matrix.test.tsx` — new
- `e2e/design-system.visual.spec.ts` — new

This stage originally declared `src/styles/theme.css — new` beside `src/styles/app.css`. There is no
`theme.css`: the Tailwind 4 `@theme inline` layer is declared inside `app.css`, and the two entries
are one. `app.css` opens with the reason it stays there — `tokens.css` must land unlayered and
_before_ the layer for a single `data-theme` attribute to repaint the product, and splitting the
layer into a fourth file would put that ordering contract in two places. So the entry is `— edit`,
and extracting the layer is explicitly not this plan's work.

### Data and migration

None. This stage reads no table and adds no column.

### Server (repo, server function, Zod)

None. The gallery route is static and takes no input. It is mounted under `_dev` and its
`beforeLoad` returns `notFound()` unless `import.meta.env.DEV` — a component gallery on a production
domain is an information leak about unshipped surfaces, and a route guard is cheaper than remembering
to delete it.

### UI (route, components)

- **Route.** `/_dev/gallery`, SSR (default), dev-only per above. It is designed to be the visual
  evidence surface for every foundations primitive stage — `00-S6`, `00-S8`, `00-S10`, `00-S13` and
  `00-S16` will cite its frames rather than build their own route. Written in the future tense
  deliberately: the route does not exist, and the frames those five stages were expected to cite
  were never captured. Nothing may be ticked against this surface until it ships.
- **Components.** `state-grid.tsx` renders one primitive family per section, each in **rest, hover,
  focus-visible, active, disabled and loading**, forced through data attributes rather than real
  pointer state so a screenshot can capture them. `token-sheet.tsx` renders every token with its
  computed value and its measured contrast ratio against its intended background.
- **States.** The gallery has no async surface and therefore no empty, skeleton or error state; it
  says so on the page rather than leaving a reader to wonder. What every surface that _does_ have an
  async surface declares for those three states is inventoried in `docs/STATE-INVENTORY.md`, which
  also records the house rule separating a skeleton from a spinner.
- **Tokens.** Every token this stage needs already exists from `00-S3`. If a primitive stage reports
  a missing token, it is a `00-foundations.md` requisition and never a hex literal here.
- **Accessibility.** The gallery is designed to be the surface the AAA claims are demonstrated on:
  every hit area measured at ≥44×44 CSS px by the visual spec, and the focus ring checked against
  `docs/ACCESSIBILITY.md` §3's 2.4.11 / 2.4.12 statement at every scroll position. It demonstrates
  none of that today, because it does not exist — where the evidence for those five claims comes
  from meanwhile is #215.

### Quota

This stage creates no countable row: it is a dev-only route over static content.

### Tenant isolation test

None — the stage adds no repository function and reads no tenant row. Stated rather than skipped: the
gallery renders literals.

### Money invariant

The gallery renders sample amounts through `formatMoney`, re-exported from `src/lib/money.ts`, in
both `en` and `pl` and for a 0-, 2- and 3-digit currency, so that a regression in `digits` handling
is **visible** rather than only unit-tested. No amount originates in this stage; every one is a
literal minor-unit integer in the fixture. Held by the money suites owned by `00-S4` —
`src/lib/__tests__/money-core.test.ts`, `src/lib/__tests__/money-convert.test.ts`,
`src/lib/__tests__/money-allocate.test.ts` and `src/lib/__tests__/money-format.test.ts`; this stage
adds no case of its own and says so.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `state-matrix.test.tsx` enumerates the primitive barrel and **fails on any exported interactive
  primitive that does not render all five states** — the mechanical form of the §2 clause, so it
  cannot be ticked without being true.
- `src/styles/__tests__/tokens-contrast.test.ts` (owned by `00-S3`) must be green; this stage does
  not weaken it.
- Browser evidence: `/_dev/gallery`, both themes, 360 / 1280 / 2560 px — six frames — plus the forced
  hover, focus-visible, active, disabled and loading rows, which are the point of the stage.
- axe at the configured rule set on `/_dev/gallery`: zero `serious`, zero `critical`. No `moderate`
  waiver is expected; any that appears is named here before merge, never after.

### Definition of done

All seven §7 items and all ten §2 clauses. This is the stage that defines what ticking those clauses
means for every later stage, so ticking one it did not look at is worse here than anywhere else.

### Blockers

None for building the stage. One open question rides on it: `docs/ACCESSIBILITY.md` claims five AAA
criteria and this stage's gallery is the surface they were designated to be demonstrated on. The
gallery does not exist, so the provenance of those five claims is unsettled - #215. That is a
question for a human, not a blocker on the code.

---

## Stage 01-S2 — The motion contract and reduced motion

### Stage id

`01-S2` · Wave 1 · effort **M**.

### Reference rows

`DSY-05 missing → missing` — the reduced-motion test that proves a preference actually removes
motion. `e2e/reduced-motion.visual.spec.ts` is absent, and so is the `[data-motion-transform]` hook
the stage designed, which appears nowhere under `src/` or `e2e/`.

`DSY-04` — the motion tokens, the keyframe set and the global reduced-motion block — is **not** a
row of this stage. Its subject shipped inside `src/styles/tokens.css`, a shared path this plan may
never own, so the row was requisitioned into `00-S3` of `00-foundations.md`, where it reads
`missing → done`. This stage requires that contract; it does not write it.

### Owned paths

- `src/lib/motion.ts` — new
- `src/lib/__tests__/motion.test.ts` — new
- `e2e/reduced-motion.visual.spec.ts` — new

This stage originally declared `src/styles/motion.css — new`. The motion contract shipped, but it
shipped inside `src/styles/tokens.css` — one of the eight shared paths that belong to
`00-foundations.md` and to nothing else (`README.md` → _The eight shared paths_). Repointing the
entry at the file where its subject actually lives would therefore make this stage **malformed**,
and the drift guard would not catch it, because the guard checks that a path exists and not who is
allowed to own it. The entry is removed rather than repointed, `DSY-04` is requisitioned into
`00-S3`, and what this stage still asks of the shared file is written under _UI_ below as a
requirement rather than as ownership.

### Data and migration

None.

### Server (repo, server function, Zod)

None.

### UI (route, components)

- **Route.** None of its own; it is verified on `/_dev/gallery`.
- **Requisition — `00-S3`, `src/styles/tokens.css`.** This stage does not own the motion tokens, the
  keyframe set or the global reduced-motion block; `00-foundations.md` writes the shared files and
  `DSY-04` records that they shipped. What this stage requires of them, as a requirement rather than
  as ownership: a duration scale whose slowest step stays under the 400 ms ceiling, an easing set,
  keyframes that animate `transform` and `opacity` only, and a `prefers-reduced-motion: reduce`
  block that collapses every one of the durations rather than blanket-killing animation — because a
  `!important` `animation: none` breaks components that wait on `animationend`, which is how a
  dialog that never closes gets shipped. All of that is in the tree; the one clause that is not is
  the `[data-motion-transform]` reset, and it stays an open requirement below.
- **Components.** `src/lib/motion.ts` exports `useReducedMotion()` and the shared transition presets,
  whose durations resolve from the `tokens.css` scale rather than from literals. Every animation in
  the product goes through one of them. The presets are hand-rolled: the `motion` package this clause
  once named was removed by ADR 0019, because it was declared and imported by nothing and this stage
  was its only justification. A preset that genuinely needs a JS animation library is a new
  dependency decision, made in a new ADR.
- **States.** Not applicable — no async surface.
- **Tokens.** The duration scale and the easing set live in `tokens.css` from `00-S3`; this stage
  consumes them. The scale that shipped is **90 / 150 / 220 / 320 ms** with four easings. This
  document previously asserted a 150–260 ms band, which was never true of the tree; the band was a
  _value_ inside a shared path this plan does not own, so the document moves to the shipped values
  rather than the values moving to the document. **The invariant is the 400 ms ceiling**: nothing
  over 400 ms exists in the product except a deliberately-declared ambient loop, and there is none
  in v1. Whether 320 ms is the right slowest step is a separate question and is not settled here.
- **Accessibility.** `prefers-reduced-motion: reduce` collapses every animation to `0.01ms` and one
  iteration and keeps indeterminate progress indicators readable — both shipped, in the
  reduced-motion block of `tokens.css`. **Motion is transform and opacity only** — a
  layout-affecting animation is a layout shift wearing a nicer name. One clause of this contract is
  **unimplemented**: reduced motion never resets `transform` on a parked element, and the
  `[data-motion-transform]` hook designed for it exists nowhere in the tree. It is kept as an open
  requirement rather than deleted, because deleting it would erase the only written record that the
  enforcement was designed.

### Quota

No countable row.

### Tenant isolation test

None — no data access.

### Money invariant

An animated number is a number that is wrong for the duration of the animation. This stage forbids
count-up / odometer animation on any amount anywhere in the product: an amount appears at its final
value or not at all. Held by `src/lib/__tests__/motion.test.ts` → _no preset animates a numeric text
node_ and enforced in review by the rule being written down here rather than assumed.

### Verification

- Command gate.
- `motion.test.ts`: every exported preset stays under the 400 ms ceiling, resolves its duration from
  a `tokens.css` duration token rather than a literal, animates only `transform` and `opacity`, and
  returns a zero-duration variant under the reduced-motion flag. The assertion is the ceiling and
  the token indirection, not a band: a band would re-assert a shared-path value this stage does not
  own, which is the contradiction that made this document wrong about the tree.
- `e2e/reduced-motion.visual.spec.ts`: with `prefers-reduced-motion: reduce`, a frame captured
  immediately after paint is **pixel-identical** to one captured 1 s later on the same route. That is
  the falsifiable form of "reduced motion is honoured"; reading the CSS is not.
- Browser evidence: `/_dev/gallery` with the reduce preference set, both themes, three widths.
- axe on `/_dev/gallery`: zero `serious`, zero `critical`.

### Definition of done

All seven §7 items and all ten §2 clauses, with the motion clause carrying this stage's weight.

### Blockers

- **`motion@^13.2.0` - resolved (#213, ADR 0019).** The package was declared in `package.json` and
  imported by zero files; this stage's `src/lib/motion.ts` was its only justification, so the package
  and the stage were one decision. A human took it and **removed the package** rather than scheduling
  this stage to justify it. The entry is kept rather than deleted, because the record of a dependency
  that was carried unused for the length of a plan is worth more than a clean list. This stage stays
  open and buildable: its presets are hand-rolled against the `tokens.css` duration scale, and a
  preset that genuinely needs a JS animation library is a new dependency decision in a new ADR.
- **The `[data-motion-transform]` reset is unimplemented (#214).** A live accessibility gap rather
  than a documentation one; the row stays open and the defect is tracked on its own issue.
- **The drift guard cannot see the shared-path rule (#216).** This stage is the first that could
  trip it: repointing `src/styles/motion.css` at `src/styles/tokens.css` would have produced a
  malformed stage that the guard would have passed. The requisition of `DSY-04` into `00-S3` avoids
  it here; the assertion that would catch the next one is filed against the guard's owner.

---

## Stage 01-S3 — The primitive inventory and its requisitions

### Stage id

`01-S3` · Wave 1 · effort **M**. The written inventory that `00-S6` builds against, and the lint
boundary that keeps a second implementation from appearing.

### Reference rows

`DSY-06 missing → partial` — the primitive inventory document and the barrel contract. The barrel
shipped as `src/components/ui/index.ts`. The inventory did not: `docs/DESIGN-PRIMITIVES.md` is
absent, and so is `src/components/__tests__/no-duplicate-primitives.test.ts`, which cross-checks the
two against each other. The row stays open on the inventory half, which this stage still owns.
`DSY-07 missing → done` — the ESLint boundary rule for `src/components/ui/**` is in
`eslint.config.js`, as a `no-restricted-imports` block scoped to that directory: _components/ui never
imports from server/. Pass data in as props._

### Owned paths

- `docs/DESIGN-PRIMITIVES.md` — new
- `eslint.config.js` — edit
- `src/components/__tests__/no-duplicate-primitives.test.ts` — new

### Data and migration

None.

### Server (repo, server function, Zod)

None. The rule this stage encodes is the inverse: **`components/ui` never imports from `server/`**,
and `eslint.config.js` gains the `no-restricted-imports` boundary that makes it a build failure.

### UI (route, components)

- **Components.** No component is written here. `docs/DESIGN-PRIMITIVES.md` lists every primitive
  `00-S6`, `00-S8`, `00-S10`, `00-S13` and `00-S16` build, with, for each: the RAC component it wraps,
  its `cva` variants, its required props, and the one sentence describing what it is for. A feature
  stage reads this list before adding a component, and a primitive that is not on it does not exist.
- **States.** Not applicable.
- **Tokens.** None new.
- **Accessibility.** Each inventory entry records the keyboard contract and the accessible-name
  source, so a feature stage can tell whether a primitive already solves its problem.

### Quota

No countable row.

### Tenant isolation test

None — no data access.

### Money invariant

The inventory records that there is **exactly one** amount input and **exactly one** amount column
helper in the product, and that both delegate to `src/lib/money.ts`. Measured at the reconciliation:

- The amount **input** is settled. `MoneyField` shipped as `src/components/ui/money-field.tsx` under
  issue #106, which consolidated two feature-local amount fields into the one primitive `00-S10`
  designated; `00-foundations.md` records it as `FND-23 missing → done`. The one-owner claim is true
  of the tree today, and this document no longer describes it as a gap.
- The amount **column helper** is still owed. `src/components/ui/data-table.tsx` does not exist, and
  the only `data-table.tsx` in the tree is `src/components/charts/data-table.tsx`, which is the
  chart text equivalent required by ADR 0007 and not a reusable table. `00-foundations.md` carries
  that as `FND-18 missing → partial`; nothing here re-opens or duplicates it.

`no-duplicate-primitives.test.ts` fails if a second component exporting a currency-formatting
function appears anywhere under `src/components/`.

### Verification

- Command gate.
- `no-duplicate-primitives.test.ts` cross-checks the barrel against the inventory document and fails
  on either direction of drift — a primitive in the barrel that is undocumented, or documented and
  missing.
- A lint fixture asserting a `src/components/ui/*` file importing `src/server/*` fails.
- No browser evidence and no axe run: this stage ships no surface. Stated as an exemption rather than
  omitted.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply (no surface).

### Blockers

None for building the stage. One figure depends on it: `docs/plans/README.md` describes this plan as
`~45 React Aria primitives`, which is not derivable from the tree: `src/components/ui/` holds 40
modules besides the barrel, and the barrel re-exports them in 80 statements — 118 value symbols and
69 types, 187 names in all. Not one of those five numbers is 45, and no counting rule anywhere says
which of them a "primitive" is. `docs/DESIGN-PRIMITIVES.md`
is that counting rule, so the register figure is re-stated from the inventory once this stage ships
(#218).
