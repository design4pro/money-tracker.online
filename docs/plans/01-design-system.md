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

`DSY-01 missing → done` — the Tailwind 4 `@theme` layer maps every token of `00-S3` to a utility.
`DSY-02 missing → done` — the primitive gallery route renders every primitive in every state.
`DSY-03 missing → done` — the state-matrix test.

### Owned paths

- `src/styles/theme.css` — new
- `src/styles/app.css` — new
- `src/routes/_dev/gallery.tsx` — new
- `src/routes/_dev/-ui/state-grid.tsx` — new
- `src/routes/_dev/-ui/token-sheet.tsx` — new
- `src/components/__tests__/state-matrix.test.tsx` — new
- `e2e/design-system.visual.spec.ts` — new

### Data and migration

None. This stage reads no table and adds no column.

### Server (repo, server function, Zod)

None. The gallery route is static and takes no input. It is mounted under `_dev` and its
`beforeLoad` returns `notFound()` unless `import.meta.env.DEV` — a component gallery on a production
domain is an information leak about unshipped surfaces, and a route guard is cheaper than remembering
to delete it.

### UI (route, components)

- **Route.** `/_dev/gallery`, SSR (default), dev-only per above. It is the visual evidence surface
  for every foundations primitive stage: `00-S6`, `00-S8`, `00-S10`, `00-S13` and `00-S16` all cite
  its frames rather than building their own route.
- **Components.** `state-grid.tsx` renders one primitive family per section, each in **rest, hover,
  focus-visible, active, disabled and loading**, forced through data attributes rather than real
  pointer state so a screenshot can capture them. `token-sheet.tsx` renders every token with its
  computed value and its measured contrast ratio against its intended background.
- **States.** The gallery has no async surface and therefore no empty, skeleton or error state; it
  says so on the page rather than leaving a reader to wonder.
- **Tokens.** Every token this stage needs already exists from `00-S3`. If a primitive stage reports
  a missing token, it is a `00-foundations.md` requisition and never a hex literal here.
- **Accessibility.** The gallery is the surface the AAA claims are demonstrated on: every hit area is
  measured at ≥44×44 CSS px by the visual spec, and the focus ring is checked against
  `docs/ACCESSIBILITY.md` §3's 2.4.11 / 2.4.12 statement at every scroll position.

### Quota

This stage creates no countable row: it is a dev-only route over static content.

### Tenant isolation test

None — the stage adds no repository function and reads no tenant row. Stated rather than skipped: the
gallery renders literals.

### Money invariant

The gallery renders sample amounts through `formatAmount` from `src/lib/money.ts` in both `en` and
`pl` and for a 0-, 2- and 3-digit currency, so that a regression in `digits` handling is **visible**
rather than only unit-tested. No amount originates in this stage; every one is a literal minor-unit
integer in the fixture. Held by `src/lib/__tests__/money.test.ts` (owned by `00-S4`); this stage adds
no case of its own and says so.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `state-matrix.test.tsx` enumerates the primitive barrel and **fails on any exported interactive
  primitive that does not render all five states** — the mechanical form of the §2 clause, so it
  cannot be ticked without being true.
- `src/styles/__tests__/contrast.test.ts` (owned by `00-S3`) must be green; this stage does not
  weaken it.
- Browser evidence: `/_dev/gallery`, both themes, 360 / 1280 / 2560 px — six frames — plus the forced
  hover, focus-visible, active, disabled and loading rows, which are the point of the stage.
- axe at the configured rule set on `/_dev/gallery`: zero `serious`, zero `critical`. No `moderate`
  waiver is expected; any that appears is named here before merge, never after.

### Definition of done

All six §7 items and all ten §2 clauses. This is the stage that defines what ticking those clauses
means for every later stage, so ticking one it did not look at is worse here than anywhere else.

### Blockers

None.

---

## Stage 01-S2 — The motion contract and reduced motion

### Stage id

`01-S2` · Wave 1 · effort **M**.

### Reference rows

`DSY-04 missing → done` — the motion tokens, the keyframe set and the global reduced-motion block.
`DSY-05 missing → done` — the reduced-motion test that proves a preference actually removes motion.

### Owned paths

- `src/styles/motion.css` — new
- `src/lib/motion.ts` — new
- `src/lib/__tests__/motion.test.ts` — new
- `e2e/reduced-motion.visual.spec.ts` — new

### Data and migration

None.

### Server (repo, server function, Zod)

None.

### UI (route, components)

- **Route.** None of its own; it is verified on `/_dev/gallery`.
- **Components.** `src/lib/motion.ts` exports `useReducedMotion()` and the `motion` package's shared
  transition presets. Every animation in the product goes through one of them.
- **States.** Not applicable — no async surface.
- **Tokens.** Durations 150–260 ms and the easing set live in `tokens.css` from `00-S3`; this stage
  consumes them. Nothing over 400 ms exists in the product except a deliberately-declared ambient
  loop, and there is none in v1.
- **Accessibility.** `prefers-reduced-motion: reduce` collapses every animation to `0.01ms` and one
  iteration, resets `transform` on `[data-motion-transform]`, and keeps indeterminate progress
  indicators readable. **Motion is transform and opacity only** — a layout-affecting animation is a
  layout shift wearing a nicer name.

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
- `motion.test.ts`: every exported preset is within 150–260 ms, animates only `transform` and
  `opacity`, and returns a zero-duration variant under the reduced-motion flag.
- `e2e/reduced-motion.visual.spec.ts`: with `prefers-reduced-motion: reduce`, a frame captured
  immediately after paint is **pixel-identical** to one captured 1 s later on the same route. That is
  the falsifiable form of "reduced motion is honoured"; reading the CSS is not.
- Browser evidence: `/_dev/gallery` with the reduce preference set, both themes, three widths.
- axe on `/_dev/gallery`: zero `serious`, zero `critical`.

### Definition of done

All six §7 items and all ten §2 clauses, with the motion clause carrying this stage's weight.

### Blockers

None.

---

## Stage 01-S3 — The primitive inventory and its requisitions

### Stage id

`01-S3` · Wave 1 · effort **M**. The written inventory that `00-S6` builds against, and the lint
boundary that keeps a second implementation from appearing.

### Reference rows

`DSY-06 missing → done` — the primitive inventory document and the barrel contract.
`DSY-07 missing → done` — the ESLint boundary rule for `src/components/ui/**`.

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

The inventory records that there is **exactly one** amount input (`MoneyField`, `00-S10`) and
**exactly one** amount column helper (`data-table.tsx`, `00-S8`) in the product, and that both
delegate to `src/lib/money.ts`. `no-duplicate-primitives.test.ts` fails if a second component
exporting a currency-formatting function appears anywhere under `src/components/`.

### Verification

- Command gate.
- `no-duplicate-primitives.test.ts` cross-checks the barrel against the inventory document and fails
  on either direction of drift — a primitive in the barrel that is undocumented, or documented and
  missing.
- A lint fixture asserting a `src/components/ui/*` file importing `src/server/*` fails.
- No browser evidence and no axe run: this stage ships no surface. Stated as an exemption rather than
  omitted.

### Definition of done

§7 items 1–3, 5 and 6. Item 4 does not apply (no surface).

### Blockers

None.
