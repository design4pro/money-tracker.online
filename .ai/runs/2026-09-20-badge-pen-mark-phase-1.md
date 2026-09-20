# Badge pen mark — Phase 1: the mark becomes parameterisable

Source doc: `.ai/specs/2026-09-20-badge-pen-mark-every-tone.md`
Tracking plan: `.ai/runs/2026-09-20-badge-pen-mark-phase-1.md`

## Goal

`@utility mark-pen` stops naming the stamp wash and takes it as a property, so a later phase can
hand it a different pen — with `settled` rendering byte-identically, which is the whole acceptance
criterion.

## Scope

Steps 1–3 of the spec's Implementation Plan, and nothing else.

- `src/styles/app.css` — `@utility mark-pen` gains `--mark-pen-wash` and `--mark-pen-deepen`,
  defaulting to exactly today's values; `--mark-pen-pooled`, `--mark-pen-paused`, the `::before`
  `background-color` and the `::after` gradient read them instead of naming `--color-highlighter`
  and `--color-brand` directly.
- Two new tests, each at its own seam: the compiled utility's declarations, and the class string
  `badgeVariants({ tone: 'settled' })` returns.
- The `#mark-pen-rough` filter measured at realistic density, with the number recorded.

### Non-goals

- The `--color-pen-*` token family — Phase 2.
- Any change to `badgeVariants`' tone recipes or to any of the 42 call sites — Phase 3.
- `DESIGN.md`, ADR 0022, and the spec's status move — Phase 4.
- The dark-theme pooled-edge contrast finding reported on #366. It is about the shipped palette,
  not about parameterisation, and the spec deliberately does not repair it inside these phases.

## The seams under test

Per the `tdd` skill, written down before the first test:

1. **The compiled utility.** `__unstable__loadDesignSystem` (already this repo's adjudicator in
   `src/styles/__tests__/token-classes.test.ts`) compiles `mark-pen` and the test reads the
   declarations it emits. That is the public output of the utility, not its source text.
2. **The variant recipe.** `badgeVariants({ tone: 'settled' })` — the string the component hands to
   `class`. It is already a named export and the spec's API-contract section pins it.

Not a seam, and deliberately not tested: the pseudo-elements' geometry. Nothing in this phase moves
it, and a test over it would break on every future nudge without ever catching this phase's bug.

## Risks

- **The `::after` gradient.** The spec's Step 1 names `background-color`; the blob's
  `radial-gradient` also ends in `--color-highlighter`. Leaving it behind would make Phase 3 paint a
  tone-coloured run with a lilac blob at its end. It is parameterised here, byte-identically, and
  called out because it is one declaration beyond the literal step text.
- **"Byte-identical" is a claim about the compiler, not about the source.** `var()` indirection
  resolves at computed-value time, so the assertion is that the computed values match — which is
  what the test checks and what the filter measurement re-confirms visually.
- **The spec is not on `develop`.** It lives on `spec/badge-pen-mark-every-tone` (PR #367). It is
  materialized read-only in this worktree and never committed here, so Step 3's `## Amendment`
  cannot land in the spec file from this branch; it is posted on #367 instead.

## Implementation Plan

### Phase 1: parameterise the mark

1.1 Pin the control with failing tests — the compiled-utility seam and the variant-recipe seam.
1.2 Introduce `--mark-pen-wash` / `--mark-pen-deepen` and make every consumer read them.

### Phase 2: measure the filter

2.1 Measure `#mark-pen-rough` at realistic density, both themes, and record the number.
2.2 Take the verdict: ship as is, or apply the spec's named Q1 fallback; post it on #367.

## Progress

PR: #370

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: parameterise the mark

- [x] 1.1 Pin the control with failing tests - 97a0573
- [x] 1.2 Introduce the two properties and make every consumer read them - 5dcb5f8

### Phase 2: measure the filter

- [x] 2.1 Measure the filter at realistic density - f5d1b42
- [x] 2.2 Record the number and take the Q1 verdict - f5d1b42
