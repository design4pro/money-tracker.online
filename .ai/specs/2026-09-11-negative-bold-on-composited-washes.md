# What `negative-bold` is worth on the composited washes

| Field              | Value |
| ------------------ | ----- |
| **Status**         | draft |
| **Issue**          | #178  |
| **Spec PR**        | #252  |
| **Implementation** | none  |

## 📝 TLDR

`--color-negative-bold` is held to 4.5:1 (WCAG 1.4.6 large text) and 3:1 (1.4.11, meter fill). It
clears both on all five opaque planes in both themes, but not on every ground a translucent wash
composites. Issue #178 asks which of three answers applies. This spec picks the first — **accept the
scope, state it where the token is declared, and pin it with a test** — but changes its wording: the
scope is not "`surface` only", because a live call site already puts the grade on `hover` over
`surface-sunken` and passes there. The scope is the **measured** set of grounds, recorded in full so
that the next palette edit moves a number a test is watching rather than a number nobody re-reads.

## 📝 Problem Statement

### The full matrix, not the three rows on the issue

The issue's table lists three failing composited grounds, all dark, all over `surface` or
`surface-raised`. Recomputing the same WCAG relative-luminance formula the repository already uses —
`washOver` in `src/styles/__tests__/tokens-contrast.test.ts`, which blends in sRGB without rounding —
over all five `GROUND_KEYS` in both themes gives twenty pairs, of which **eight** fall below 4.5:1:

| theme | ground           | plain  | `hover`    | `press`    |
| ----- | ---------------- | ------ | ---------- | ---------- |
| light | `canvas`         | 5.58:1 | 4.99:1     | 4.62:1     |
| light | `surface`        | 5.89:1 | 5.26:1     | 4.86:1     |
| light | `surface-raised` | 6.15:1 | 5.49:1     | 5.07:1     |
| light | `surface-sunken` | 5.09:1 | 4.56:1     | **4.23:1** |
| light | `surface-panel`  | 5.09:1 | 4.56:1     | **4.23:1** |
| dark  | `canvas`         | 5.93:1 | 5.03:1     | **4.36:1** |
| dark  | `surface`        | 5.46:1 | 4.56:1     | **3.94:1** |
| dark  | `surface-raised` | 4.82:1 | **3.98:1** | **3.44:1** |
| dark  | `surface-sunken` | 6.20:1 | 5.34:1     | 4.65:1     |
| dark  | `surface-panel`  | 5.08:1 | **4.21:1** | **3.64:1** |

Computed from the shipped token values: `--color-negative-bold` `#c31300` / `#ff5e4a`,
`--color-hover` `rgb(38 36 32 / 0.06)` / `rgb(235 232 223 / 0.07)`, `--color-press`
`rgb(38 36 32 / 0.1)` / `rgb(235 232 223 / 0.12)`, and the five plane tokens as declared in
`src/styles/tokens.css`.

Four things the issue's narrower table hides:

1. **Light fails too.** `press` over `surface-sunken` and over `surface-panel` measures 4.23:1. A
   decision written as "dark only" would be wrong on the day light grows the call site.
2. **Two of the eight failures are plain `hover`,** not `press`: dark `surface-raised` at 3.98:1 and
   dark `surface-panel` at 4.21:1. Both sit inside the five worst pairs overall. `hover` is the wash
   `rowWash` actually paints, so this is the reachable half of the problem and it is not a
   `press`-only story.
3. **`surface-sunken` passes under `hover` in both themes** (4.56:1 light, 5.34:1 dark) — and that
   ground is not hypothetical, which is the next section.
4. **The 3:1 fill floor is never at risk.** The worst pair in the whole matrix is 3.44:1, so
   `negative-bold`'s 1.4.11 obligation as a full-track meter fill is clear on every plane, every
   wash and both themes with room to spare. Everything below is about the 4.5:1 text floor alone.
   This is the most reassuring fact in the analysis and the issue does not state it.

### The scope statement the issue proposes would be factually wrong

Option 1 on the issue reads "state in `DESIGN.md` that `negative-bold` is for `surface` only".
`src/components/app/budgets/budget-card.tsx` already contradicts it. The card carries `rowWash`
(the `group/wash` hover treatment, declared in `src/components/ui/shared.ts`) on a `bg-surface` box,
and swaps to `bg-surface-sunken` when the budget is archived (lines 68–70), with `BudgetMeter`
rendered inside it. An archived, over-budget card under the pointer therefore paints
`text-negative-bold` on `hover` over `surface-sunken` today. It passes — 5.34:1 in dark, 4.56:1 in
light — but a `surface`-only rule would declare a shipped, compliant combination out of bounds, and
the first person to check the rule against the code would find the code wrong and the rule right.
Scope by what was measured, not by one plane name.

### What no call site reaches today, and why that is a convention rather than a boundary

Six of the eight failures are `press`. `--color-press` is never painted by `rowWash`: that constant
is `group/wash transition-colors duration-fast hover:bg-hover` and has no pressed half. `bg-press`
appears only on interactive controls — `controlWash` in `src/components/ui/shared.ts`,
`ui/calendar.tsx`, `ui/button.tsx` — and `negative-bold` paints exactly two things, the `AmountMeter`
headline and a full meter fill, neither of which is a control or lives inside one today.

That is a **convention, not a boundary**: nothing in the type system or the component tree prevents
someone putting an `AmountMeter` inside a pressable control, and the assertion this spec adds
(piece 2 below) covers `rowWash`, not every call site. So the pressed column is not "impossible"; it
is "unreached, and the reason it is unreached is written down." The honest version of that sentence
is what goes into the documentation, because an overstated boundary is the thing that makes the next
reader trust a guard that is not there.

The reachable risk is narrower and real: a list or card on `surface-raised` or `surface-panel`
adopting `rowWash` while showing an over-limit meter. Nothing does today.
`e2e/contrast-enhanced.spec.ts` addresses the pattern `[class~="group/wash"]` rather than a route,
and runs axe's `color-contrast-enhanced` rule, whose large-text threshold is 4.5:1 — exactly this
grade's floor. So the rendered guard already measures the right number on the right nodes; what it
cannot do is measure a ground no route renders.

### The margins are thin, and that is part of the decision

Four of the twelve passing composited pairs clear the floor by under 3%: light `hover` over
`surface-sunken` and `surface-panel` at 4.56:1, dark `hover` over `surface` at 4.56:1, and light
`press` over `canvas` at 4.62:1. Accepting the scope therefore accepts a knife-edge, not a
comfortable margin — any nudge to the palette flips one of them. That is exactly the case the
issue's third acceptance criterion is about, quoted here so this document can be checked without it:

> Whatever the choice, a test recomputes it, so the next edit to the palette cannot quietly break it
>
> - the composited grounds are exactly the ones arithmetic over token pairs misses.

### Why arithmetic and rendering both have to be in the answer

`tokens-contrast.test.ts` composites `press` only for `color-ink` and `color-ink-2`, and composites
`hover` for the large-text keys over `color-surface` alone — deliberately, with the reason recorded
at lines 494–509 and pointing at this issue. It therefore catches a token-value drift on one
composited ground and is blind on nine. `contrast-enhanced.spec.ts` catches an adoption, on whatever
grounds the seeded demo workspace actually renders, and is blind to a palette edit that no route
exercises. Neither alone satisfies the criterion quoted above.

## 📝 Proposed Solution

Option 1 from the issue, with the scope restated by measurement. Three pieces, none of which moves a
token value.

### The canonical scope statement

This is the deliverable the three prose sites share. It is written out here, verbatim, so that the
human confirmation this spec is gated on is a review of **text** rather than of an intention. Wording
may be adapted to each site's voice; the five claims it makes may not change without re-measuring.

> `negative-bold` clears its 4.5:1 large-text floor on all five opaque planes in both themes, and on
> every composited ground a call site can produce today — including `hover` over `surface-sunken`,
> which an archived over-budget budget card actually renders. It does **not** clear it on either wash
> over `surface-raised` or `surface-panel`, nor under `press` over `surface`, `canvas` or light
> `surface-sunken`. Those grounds are recorded as failing in `tokens-contrast.test.ts` rather than
> designed for: no call site produces them, and nothing but this note and that test stops one from
> being written. Putting this grade on a washed raised or panel ground is a palette decision, not a
> call-site one. Its separate 3:1 fill floor (1.4.11) is clear on every ground in the matrix, worst
> case 3.44:1.

### The three pieces

1. **Record the full matrix as the assertion.** Extend the interaction-wash block in
   `src/styles/__tests__/tokens-contrast.test.ts` so it computes every `LARGE_TEXT_KEYS` × `WASH_KEYS`
   × `GROUND_KEYS` pair and asserts the **exact partition** — which pairs clear 4.5:1 and which do
   not — rather than only the pairs that pass. `LARGE_TEXT_KEYS` is today exactly
   `['color-negative-bold']` (the list's own comment explains that `warning-bold` is deliberately
   absent), so the matrix in this spec is the complete expectation; the expectation is keyed by token
   so that adding a key without measuring it fails rather than passes. The repository already owns
   this assertion shape: the `ink-2 does not survive a wash` case asserts a token stays _below_ 7:1
   and explains why. An edit that lightens the grade turns a listed failure into a pass, the test
   goes red, and the reader is sent back to this decision instead of drifting under it.
2. **Assert the convention the pressed column rests on.** A unit assertion that `rowWash`
   (`src/components/ui/shared.ts`) contains `hover:bg-hover` and does not contain `bg-press`, with a
   comment naming this spec. Its home is the existing `src/components/ui/__tests__/` suite beside
   `shared.ts`, not the token file, because it is a claim about a class constant. It does not — and
   is not claimed to — cover every call site.
3. **Make the three prose sites agree with the matrix.** The declaration comments in
   `src/styles/tokens.css`, `DESIGN.md`'s Loud Red bullet, and `docs/ACCESSIBILITY.md` §2.1 each
   currently describe a partial picture and one of them hands the reader to this issue. All three
   carry the canonical statement above after this lands, with the failing grounds named rather than
   implied.

### Alternatives considered

**Move the token lighter (issue option 2).** The binding pair is dark `press` over `surface-raised`
at 3.44:1. Reaching 4.5:1 there means raising the grade's WCAG relative luminance from 0.2976 to
0.4045 — a **36% increase in luminance**, not a 31% one in the ratio — paid entirely out of a value
already at OKLCH C 0.1996 that #170 chose specifically to stop dark reading as salmon. It buys
contrast on six pairs no call site reaches and two that no route renders. Rejected: the cost is the
whole reason the grade exists and the benefit is hypothetical.

**Split a third grade (issue option 3).** A new custom property, a new Tailwind mapping in
`src/styles/app.css`, a new `DESIGN.md` entry and call-site plumbing, to serve zero call sites.
`DESIGN.md` already warns against reaching for `negative-bold` as a general "stronger red"; a third
red makes that warning harder, not easier. Rejected as speculative surface — the day a raised washed
list needs it, this spec's matrix is the measurement that sizes the work.

**Do nothing.** The acceptance criterion quoted above rules it out: the composited grounds are
exactly the ones arithmetic over token pairs misses, so "nothing is failing today" is a statement
with no guard behind it.

## 📝 Architecture

No new module and no new concept, so no new owner under `docs/SPEC.md` §8. The change is confined to
the existing owners of the palette and its guards:

| Concern                           | Owner module                                   | Change                                                        |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Token values and recorded ratios  | `src/styles/tokens.css`                        | Comments only; no declaration value moves                     |
| Arithmetic contrast guard         | `src/styles/__tests__/tokens-contrast.test.ts` | New assertions over the full composited matrix                |
| The wash class constants          | `src/components/ui/shared.ts`                  | Unchanged; a test is added that asserts its shape             |
| Rendered contrast guard           | `e2e/contrast-enhanced.spec.ts`                | Unchanged — it already runs the right rule on the right nodes |
| Design-system prose               | `DESIGN.md` → Loud Red                         | Carries the canonical statement                               |
| Published accessibility statement | `docs/ACCESSIBILITY.md` §2.1                   | The "#178 is where this gets decided" sentence is resolved    |

`components/ui` still never fetches and never imports from `server/`; nothing here touches
`src/server`, so no tenant-isolation or money-invariant case applies.

## 📝 Data Model

None. No migration, no schema, no stored row.

## 📝 API Contracts

None. No server function, no route, no Zod schema.

## 📝 UI/UX

No rendered pixel changes. No token value moves, no class changes on any component, no copy. The
deliverable is a documented scope plus two guards.

Accessibility position after this lands is the canonical statement above, and nothing wider. It
**narrows and specifies** the existing claim; no wording in this spec or its implementation may read
as a broader AAA claim (`AGENTS.md` → Never).

## Visual change expected

**None.** No route, state, theme or breakpoint changes on screen. Every token value, every class
constant and every rendered string is identical before and after. The change is comments, tests and
two documentation paragraphs. Light/dark and 360/1280 captures would be pixel-identical pairs, so
they are not requested for the implementation PR; the implementation's evidence is the test output,
not a frame.

## Copy

**None.** No new user-facing string, so no `en`/`pl` catalogue key is added or changed and the
`i18n-messages` skill is not engaged by this work.

## 📝 Edge Cases & Failure Scenarios

- **A future list on `surface-raised` or `surface-panel` adopts `rowWash` with a meter inside it.**
  The intended outcome is that `e2e/contrast-enhanced.spec.ts` goes red on the day the route renders
  it — the spec's `[class~="group/wash"]` selector and the `color-contrast-enhanced` rule already
  cover the case. The failure this design must avoid is a silent pass, which is why the arithmetic
  test records the ground as failing rather than omitting it.
- **Someone puts an `AmountMeter` inside a pressable control.** The pressed column becomes reachable
  and piece 2's assertion does _not_ catch it — it covers `rowWash`, not every call site. The
  mitigation is the recorded matrix and the canonical statement, both of which name `press` as a
  ground the grade does not clear, so the change is a visible decision rather than an accident.
  Widening the assertion to "no meter inside a pressed control" would need a component-tree rule this
  repository does not have, and is out of scope.
- **A palette edit lightens `negative-bold` for an unrelated reason.** A listed failing pair becomes
  a pass, the exact-partition assertion goes red, and the editor is sent to this spec. That is the
  intended behaviour, and it is why the assertion is an equality on the partition rather than a
  one-sided floor. The four pairs passing under 3% above the floor make the reverse direction just as
  live.
- **`GROUND_KEYS` or `LARGE_TEXT_KEYS` grows.** A sixth plane token, or a second large-text token,
  produces pairs the written expectation does not mention. The expectation is therefore compared as a
  whole — every computed pair must appear in it, and every listed pair must be computed — so an
  unmeasured addition fails loudly rather than slipping through an assertion that only checks the
  pairs it already knew. This is the difference between a guard and a maintenance tax, and it is the
  reason the assertion is written as a set comparison rather than a loop of `expect`s.
- **The `prefers-color-scheme: dark` block and the `[data-theme='dark']` block drift apart.**
  `negative-bold` is declared in three places (`src/styles/tokens.css` lines 215, 344, 437). The
  existing suite already parses all of them; the new assertions inherit that, so a comment updated in
  one block and not the others is caught by the ratio recomputation rather than by review.
- **The recorded ratio in a comment disagrees with the computed one.** It already does, slightly:
  the dark declaration says "4.57:1 under `--color-hover`" where the unrounded computation gives
  4.5619:1, i.e. 4.56:1. The implementation corrects it while it is rewriting those comments anyway.

## 📝 Risks & Impact Review

- **Blast radius:** documentation, comments and tests. No runtime code path, no rendered output, no
  binding, no migration. `pnpm build` output is unchanged apart from CSS comments, which do not ship.
- **`BACKWARD_COMPATIBILITY.md`:** no listed surface is touched — this is not schema, API, auth,
  billing or the ledger.
- **`AGENTS.md` → Ask First, "anything that widens the accessibility claim":** engaged in the
  narrow sense that `docs/ACCESSIBILITY.md` is a published representation (its own §2.2 explains why
  the wording is a liability question). The change narrows and specifies rather than widens, but the
  final phrasing wants a human's eye, which is why the canonical statement is written out above.
  The choice of option 1 was confirmed by @rafalwolak on 2026-09-11; the `docs/ACCESSIBILITY.md`
  wording is still approved separately on the implementation PR (Phase 1, step 6).
- **Rollback:** revert the PR. Nothing is persisted, generated or migrated.
- **If a later review overrides option 1 with option 2 or option 3:** this spec is superseded, not
  amended — its Proposed Solution and Implementation Plan are entirely option-1 shaped. The correct
  move is to close the spec PR unmerged and re-run the design with the chosen option; the Problem
  Statement matrix carries over verbatim and is what sizes either alternative. Choosing option 1 now
  does not make either harder later, which is the reason it is the default.

## Resolved assumptions (autonomous defaults)

Each row is independently overridable. Where the reasoning is longer than a line it lives in the
section named, rather than being restated here.

| #   | Question                                                                                                      | Resolution                                                                                                       | Rationale                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Which of the issue's three options applies: accept the scope, move the token lighter, or split a third grade? | **Option 1 — accept the scope.** Confirmed by @rafalwolak on 2026-09-11.                                         | Lowest blast radius and the only reversible one — see _Alternatives considered_. Held for human confirmation because the issue calls all three a human trade-off and `docs/ACCESSIBILITY.md` is on `AGENTS.md` Ask First. |
| Q2  | Is the scope "`surface` only", as the issue words option 1?                                                   | **No — the measured set of grounds**, written out under _The canonical scope statement_.                         | A shipped call site already contradicts a `surface`-only rule — see _The scope statement the issue proposes would be factually wrong_.                                                                                    |
| Q3  | Where does the enforcing test live: arithmetic, rendered, or both?                                            | **Both, different jobs.** Arithmetic gains the full matrix; the rendered spec already covers adoption unchanged. | Each is blind to what the other catches — see _Why arithmetic and rendering both have to be in the answer_.                                                                                                               |
| Q4  | Does this decision also cover `warning-bold`, the other loud grade?                                           | **No — out of scope**, and it stays out of `LARGE_TEXT_KEYS`.                                                    | It paints no text at any size, so 1.4.6 never reaches it and only the 3:1 fill floor applies, which it clears everywhere. #171 settled that and `tokens-contrast.test.ts` records it.                                     |
| Q5  | One-sided floor on the passing grounds, or an equality on the partition?                                      | **Equality on the partition**, compared as a whole set.                                                          | A one-sided floor is silent when the palette moves the other way, and four pairs pass by under 3%. It is also what makes a new ground or key fail loudly.                                                                 |
| Q6  | Does the implementation also fix the `4.57:1` comment that should read `4.56:1`?                              | **Yes**, within the comment rewrite it is already doing.                                                         | Surgical, and a recorded ratio that disagrees with the test recomputing it is the exact failure mode this spec exists to prevent.                                                                                         |

## 📋 Phasing

One phase. The three pieces are a single coherent change — the prose is only true because the test
holds it, and the test is only legible because the prose explains the convention — and splitting them
would land a documented scope with no guard, or a guard with no reason recorded beside it. The work
is small enough that phasing would be ceremony.

## 📋 Implementation Plan

### Phase 1 — Record the scope and pin it

1. **Write the failing test for the full composited matrix.** In
   `src/styles/__tests__/tokens-contrast.test.ts`, inside the existing interaction-wash
   `describe.each`, add a case that computes every `LARGE_TEXT_KEYS` × `WASH_KEYS` × `GROUND_KEYS`
   pair with the file's own `washOver` + `contrastRgb`, then compares the **set of pairs at or above
   4.5:1** against a written-down set of `token · wash · ground` names. The expectation is a set of
   names, never a set of ratios: the ratios are computed, so a rounding change cannot turn the suite
   red on its own. Write the expectation empty first.
   → verification: `pnpm exec vitest run src/styles/__tests__/tokens-contrast.test.ts` is red, and the
   diff in the failure message lists all twelve passing pairs by name.
2. **Fill in the partition and make it green.** The twelve passing and eight failing pairs are the
   table in this spec's Problem Statement. Compare in both directions so an unmeasured new ground or
   key fails rather than slips through. The comment above the case states what a red run means: the
   palette moved and the #178 decision is back on the table.
   → verification: the same command is green; `pnpm test` is green; temporarily deleting one ground
   from the expectation turns it red with that ground named.
3. **Assert the convention that keeps the pressed column unreached.** Add a case in
   `src/components/ui/__tests__/` asserting `rowWash` contains `hover:bg-hover` and does not contain
   `bg-press`, with a comment naming this spec and stating plainly that it covers the constant, not
   every call site.
   → verification: `pnpm test` green; adding `active:bg-press` to `rowWash` locally turns it red, and
   reverting turns it green again.
4. **Restate the declaration comments in `src/styles/tokens.css`.** All three
   `--color-negative-bold` sites carry the canonical statement's claims and the corrected `4.56:1`
   figure; the block comment at the top of the file (lines ~64–74) names the composited grounds the
   grade does not clear and points at the test rather than at an open issue. No declaration value
   changes.
   → verification: `git diff src/styles/tokens.css` touches comment lines only — no line containing
   `--color-negative-bold:` changes — and `pnpm test` stays green, which it cannot if a value moved.
5. **Carry the canonical statement into `DESIGN.md`'s Loud Red bullet.** The existing "never
   body-size text, never a partial fill" rules are untouched and no AAA claim is added.
   → verification: `pnpm check` leaves it prettier-clean, and the bullet asserts the same five claims
   as the canonical statement — every failing ground named, the `surface-sunken` hover exception
   named, the 3:1 floor stated as clear, the convention described as a convention, and no wider
   claim. That last list is the review checklist for this step, not a prose-identity check.
6. **Resolve `docs/ACCESSIBILITY.md` §2.1.** Replace the sentence that defers to #178 with the
   decision and its measured scope. The AA-plus-five-AAA-criteria claim is unchanged.
   → verification: `grep -n "#178" docs/ACCESSIBILITY.md` returns nothing, and the paragraph passes
   the same five-claim checklist as step 5. The wording is additionally the Ask First item: the
   implementation PR carries `review` and does not merge until a human approves this file's diff
   specifically. If no confirmation arrives the PR waits — it does not merge on a timeout.
7. **Run the gate.** The full `validation.commands` sequence from `.ai/agentic.config.json`, in
   order, then `pnpm e2e`. The e2e run is **mandatory for this PR rather than optional**, because
   this spec's claim that `e2e/contrast-enhanced.spec.ts` needs no edit is verified only by running
   it unchanged and green. If the environment cannot be brought up, the claim is downgraded in the PR
   body to unverified rather than quietly assumed.
   → verification: every gate command exits zero; `pnpm e2e` green with `git diff --exit-code -- e2e/`
   clean.
