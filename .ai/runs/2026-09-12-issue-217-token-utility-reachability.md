# Execution plan — every registered token is reachable through a utility

`Source doc:` `.ai/specs/2026-09-10-token-utility-reachability.md`
`Issue:` #217
`Spec PR:` #223 (merged 2026-09-10)
`Engine:` om-auto-create-pr (steps: 6, --loop: no)

## Goal

Hold the second direction of the token contract: every custom property declared in
`src/styles/tokens.css` is read by the CSS of at least one utility the design system can compile, or
appears in a reasoned allowlist that says why it is not a class.

## Scope

The spec's single Phase, on this one PR:

- `src/styles/__tests__/token-classes.test.ts` — the memoized design-system loader, the new case, the
  floor assertion, the `UNREACHABLE_BY_DESIGN` table and its two tightness assertions, and the
  docblock's _"What this cannot check"_ update.
- `docs/plans/01-design-system.md` — the `DSY-01` row gains the reference to the case that makes it
  falsifiable.
- `.ai/specs/2026-09-10-token-utility-reachability.md` + `.ai/specs/README.md` — spec lifecycle
  bookkeeping owned by `om-auto-implement-spec` (`Status`, `Implementation`, the generated index).

## Non-goals

- Surfacing or deleting any of the tokens the new case finds unreachable (spec Q3). The allowlist
  records them; acting on them is a separate, product-level call.
- The third direction — a token no utility **and no other consumer** reads (spec Q4).
- The `src/lib/cn.ts` parity gap (spec Q5).
- Any change to `src/styles/tokens.css` or `src/styles/app.css`. No rendered output moves, so no
  frames are captured (ADR 0016 applies to changes that paint).
- Any dependency change. `tailwindcss` and `@tailwindcss/oxide` are already imported by this file and
  the set is frozen (`docs/SPEC.md` §3).

## Risks

- **The allowlist is the whole reviewable surface.** An entry whose reason is wrong suppresses a real
  finding, so each of the 22 carries the reason from the spec's grouping table, and the two tightness
  assertions make the list shrink-only: an entry that became reachable fails, and so does one naming
  a token `tokens.css` no longer declares.
- **`getClassList()` is on the same `__unstable__` surface the file already depends on.** A Tailwind
  shape change would otherwise report 140 unreachable tokens instead of one honest failure, which is
  what step 1.3's floor assertion exists for.
- **Cost.** The spec measured ≈1.2 s for the new case against the 15 s per-case budget
  (`SLOW_STARTUP_TEST_TIMEOUT_MS`). Re-measure rather than assume; no timeout change is proposed.
- **A gate nobody watched fail is not trusted** (skill `verifying-changes`). Steps 1.2 and 1.5 are
  watched-red steps and their output goes in the PR body.

## Implementation Plan

### Phase 1 — The converse gate

- **1.1 Hoist the design-system loader.** Extract the `__unstable__loadDesignSystem` call out of the
  existing case body into one memoized module-level helper, used by both cases. No behaviour change
  to the existing assertion. _Verification:_
  `pnpm exec vitest run --project=server src/styles/__tests__/token-classes.test.ts` — the existing
  case still passes.
- **1.2 Add the case, red, with an empty allowlist.** Strip comments from `tokens.css`, collect
  declared custom-property names, compile every `getClassList()` name, collect every `var(--…)` the
  emitted CSS reads, assert declared minus reachable is empty. _Verification:_ the case fails listing
  exactly the tokens the spec tabulates; the red output is recorded for the PR body.
- **1.3 Add the floor assertion.** The class list is non-trivially large and contains a known-good
  name (`bg-canvas`), so an upstream API change fails as itself. _Verification:_ 1.2's failure is
  unchanged; stubbing the class list to `[]` produces the floor failure instead.
- **1.4 Fill the allowlist and go green.** The entries with their reasons, plus the two tightness
  assertions. _Verification:_ the case passes; removing an entry fails naming that token; an entry
  for a reachable token fails as a stale suppression; an entry for an undeclared name fails as an
  orphan.
- **1.5 Prove it catches the real defect.** Temporarily add `--color-probe: red` to `tokens.css`
  without touching `app.css`, confirm the case fails naming `--color-probe`, remove the probe.
  _Verification:_ the red output goes in the PR body; `git diff --exit-code -- src/styles/tokens.css`
  clean afterwards.
- **1.6 Record what now holds `DSY-01`.** Extend the docblock's _"What this cannot check"_ so the
  third bullet separates the direction now held (token → utility) from the one still not (token → any
  consumer), and add the reference to `docs/plans/01-design-system.md`. Spec lifecycle bookkeeping in
  the same step. _Verification:_ `pnpm exec vitest run --project=tooling scripts/plans` green, then
  the full gate in `AGENTS.md` order.

## Progress

PR: #258

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The converse gate

- [x] 1.1 Hoist the design-system loader — aa9fd52
- [x] 1.2 Add the case, red, with an empty allowlist — d1f2ce3
- [x] 1.3 Add the floor assertion — 606a2af
- [x] 1.4 Fill the allowlist and go green — 1dcbda1
- [x] 1.5 Prove it catches the real defect — evidence only, red output in the PR body
- [x] 1.6 Record what now holds DSY-01 — 13214a2
