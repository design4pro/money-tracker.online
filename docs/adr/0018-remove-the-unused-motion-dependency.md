# 0018. The `motion` package is removed from the dependency set

Status: accepted
Date: 2026-09-11

## Context

`motion@^13.2.0` has been declared in `package.json` since the initial dependency set was pinned,
and it is imported by **zero** files. Not "used sparingly", not "used behind a flag" - `motion`,
`motion/react` and `framer-motion` appear in no `.ts`, `.tsx`, `.js` or `.mjs` file anywhere outside
`node_modules`.

Its only justification in the repository is stage `01-S2` of `docs/plans/01-design-system.md`, which
asserts that `src/lib/motion.ts` "exports `useReducedMotion()` and the `motion` package's shared
transition presets. Every animation in the product goes through one of them." That module never
landed, and neither did its test or `e2e/reduced-motion.visual.spec.ts`.

The motion the product actually ships is CSS, and it shipped somewhere else: four durations and four
easings as tokens in `src/styles/tokens.css`, the keyframe set in `src/styles/app.css`, and a global
`prefers-reduced-motion: reduce` block that collapses every one of those durations to `0.01ms`. That
block is why reduced motion works today, with no JavaScript involved. `DSY-04` records it as shipped
against `00-S3` of `00-foundations.md`.

The design-system plan reconciliation (#201) surfaced the mismatch and deliberately did not resolve
it. SPEC §3.1 freezes the dependency set against stages and agent runs, and `AGENTS.md` puts adding,
removing or upgrading a package under **Ask First**, so a design-only documentation change is not
where a dependency decision is spent. The reconciliation recorded a `### Blockers` entry with
disposition **defer** and filed issue #213 - a pointer to a decision, not the decision.

Issue #213 named the two honest options: remove the package, or schedule `01-S2` so that the package
has a justification again.

## Decision

`motion` is removed from `package.json` and `pnpm-lock.yaml`. `framer-motion@13.2.0`,
`motion-dom@13.2.0` and `motion-utils@13.0.0` leave with it; nothing else in the tree depended on
them.

The alternative - scheduling `01-S2` - was rejected as a way of resolving _this_ question rather
than on its own merits. `01-S2` is a stage with a spec, an owned module, a unit test and a visual
e2e spec, and it deserves to be scheduled when the product needs JS-driven transitions, not because
an unused dependency wants a reason to exist. Building a module to justify a package inverts the
order the freeze exists to protect.

**This does not close `01-S2`.** The stage stays open and buildable, minus one promise it could not
keep: `src/lib/motion.ts` no longer owes anyone the `motion` package's presets. If the stage is
scheduled and the presets genuinely need a JS animation library, that is a new dependency decision,
made here, in a new ADR, with the reason attached - which is the same door `@cloudflare/vitest-pool-workers`
came through in ADR 0015.

## What this costs

Nothing at runtime: removing a package no module imports cannot change a byte of the bundle. The
cost is optionality. A future `src/lib/motion.ts` that wants spring physics, gesture-driven
transitions or layout animation starts from a re-install and a fresh ADR rather than from an import.
That is the intended shape - the freeze makes adding a package a decision rather than a reflex, and
this removal does not exempt the re-addition from it.

The removal is also a small, reversible bet that the CSS contract is sufficient. It has been
sufficient for everything shipped so far. If that stops being true, the evidence will be a concrete
animation the token scale cannot express, which is a far better argument for the package than an
unimported line in `package.json`.

## Consequences

- SPEC §3 no longer lists `motion` in the pinned stack, and §3.1 records the removal citing this ADR
  beside ADR 0015's addition. The set is changed by a human in an ADR in both directions.
- `01-S2` in `docs/plans/01-design-system.md` drops the `motion` package from its `### UI` →
  _Components_ clause: `src/lib/motion.ts` still exports `useReducedMotion()` and the shared
  transition presets, and the presets resolve their durations from the `tokens.css` scale, which is
  what `motion.test.ts` was already specified to assert.
- The `### Blockers` entry for `motion@^13.2.0` on `01-S2` is marked **resolved** and cites this ADR.
  It is not one of §3.1's four dispositions: those answer "a stage needs a package it does not have",
  and this is the opposite question. The entry stays in the document rather than being deleted,
  because the record of a dependency carried unused for the length of a plan outlives the list it
  was on. The two remaining blockers on that stage - `[data-motion-transform]` (#214) and the drift
  guard's blindness to the shared-path rule (#216) - are untouched and stay open.
- `.ai/specs/implemented/2026-09-08-design-system-plan-reconciliation.md` is left exactly as it is.
  It is an archived record of what was decided then, and _defer_ was the correct answer for a
  design-only spec. Rewriting it to match a later decision would erase the routing that produced
  this one.
