# Reduced motion: the `[data-motion-transform]` reset and the proof it works

| Field              | Value            |
| ------------------ | ---------------- |
| **Status**         | implemented      |
| **Issue**          | #214             |
| **Spec PR**        | #251             |
| **Implementation** | #254, #416, #419 |

## 📝 TLDR

Stage `01-S2` of `docs/plans/01-design-system.md` writes the reduced-motion contract as three
clauses: collapse every animation to `0.01ms` and one iteration, keep indeterminate progress
indicators readable, and **reset `transform` on `[data-motion-transform]`**. The first two shipped
inside the `REDUCED MOTION` block of `src/styles/tokens.css`. The third exists in no form at all:
the attribute appears zero times under `src/` and `e2e/`, there is no rule that would act on it, and
`e2e/reduced-motion.visual.spec.ts` — the falsifiable proof the same stage specified — was never
written.

This spec adds the missing clause and the missing proof. One declaration inside the existing
media block resets `transform` on the hook; five components that animate `transform` and whose
resting transform is `none` gain the attribute; one component that animates `transform` and whose
resting transform is deliberately **not** `none` is excluded, and the exclusion is derived rather
than allowlisted. Two tests make the claim checkable: a browser proof that a frame captured after
paint is pixel-identical to one captured a second later, and a source guard that a new
transform-animating element cannot be added without deciding which of the two groups it is in.

No schema, no repository, no server function, no amount, no user-facing copy. `docs/ACCESSIBILITY.md`
is not edited: §2.3.3 already reads _"effectively met"_, and this change makes that sentence true
rather than widening it.

## 📝 Problem Statement

### What the stylesheet does today

`src/styles/tokens.css:839` collapses the durations rather than killing animation outright, and the
docblock above it explains why in terms this spec does not relitigate: a blanket `!important`
`animation: none` breaks any component that waits on `animationend`, which is exactly how React Aria
unmounts an exiting overlay, and the result is a dialog that never closes.

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-instant: 0.01ms; /* …fast, base, slow */
  }

  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

That is two of the three clauses. The trade-off the docblock accepts — and which `01-S2` answered
with the hook — is that an animation collapsed to sub-frame length still _runs_, and an element
whose resting position is expressed **through** that animation keeps whatever transform the
collapsed run left on it. Nothing resets it.

### The honest size of the defect, measured rather than assumed

The complete inventory of transform-animating elements in the product, read from
`src/styles/app.css:183`–`:193` (the `--animate-*` utilities) against the `@keyframes` at `:204`–`:268`:

| Element                                | Animation                  | Resting transform   | Parks wrong today? |
| -------------------------------------- | -------------------------- | ------------------- | ------------------ |
| `dialog.tsx` modal panel               | `dialog-in` / `dialog-out` | `none`              | No                 |
| `dialog.tsx` panel, `drawer` placement | `drawer-in` / `drawer-out` | `none`              | No                 |
| `popover.tsx` panel (via `popMotion`)  | `pop-in` / `pop-out`       | `none`              | No                 |
| `tooltip.tsx` bubble                   | `pop-in` / `pop-out`       | `none`              | No                 |
| `progress-bar.tsx` indeterminate fill  | `indeterminate` (infinite) | `none`              | No                 |
| `spinner.tsx` ring                     | `spin` (infinite)          | `none`              | No                 |
| `skeleton.tsx` sheen                   | `shimmer` (infinite)       | `translateX(-100%)` | No                 |

**None of the seven is visibly misplaced right now**, and this spec says so plainly rather than
writing a reproduction that does not reproduce. The reason every one of them is correct is a
property nothing in the repository states or enforces: not one of the `--animate-*` utilities
declares `animation-fill-mode`, so each falls back to `none`, and a finished animation therefore
surrenders the element back to its static CSS. The three infinite animations are cut to one
iteration by the sweep and land in the same place.

So the product is correct **by accident of a default**. Add `forwards` to one utility — the ordinary
thing to reach for when an exit animation flickers back to its start before React Aria unmounts it —
and the shimmer parks at `translateX(100%)`, the sweep parks the indeterminate bar at
`translateX(300%)` outside its own track, and the drawer parks a full panel height below the fold.
Under `prefers-reduced-motion: reduce`, for the one user who cannot watch it happen and has no frame
of reference for where the thing was supposed to be.

### Why that still makes it a defect and not a nice-to-have

Three reasons, in order of weight.

1. **A written accessibility contract that nothing implements is a false record.** `01-S2` states
   the clause, `00-S3`'s `DSY-04` row records that it is _"not implemented and stays open there"_,
   and `docs/adr/0019-remove-the-unused-motion-dependency.md:76` lists it as one of two remaining
   blockers on the stage. Three documents describe a mechanism that does not exist. The
   reconciliation (#201) deliberately kept the clause rather than deleting it, on the grounds that
   deleting it would erase the only record that the enforcement was designed.

2. **There is no assertion in either direction.** `e2e/reduced-motion.visual.spec.ts` is absent, so
   nothing in the gate would notice reduced motion breaking — not this clause, not the two that did
   ship. `docs/ACCESSIBILITY.md` §2.3.3 says `prefers-reduced-motion: reduce` _"removes every
   non-essential animation without exception"_, and §5.3 lists _"`prefers-reduced-motion: reduce`
   set, and the surface still usable and still legible"_ as a manual step. The claim rests on a
   stylesheet being read correctly by a person, which is the thing `AGENTS.md` means by _"every
   number you write down came from a command whose output you read"_.

3. **The defence has to exist before the change that needs it.** A reset added the day someone
   reaches for `forwards` is a reset added after the bug shipped, and the bug is invisible to
   everyone who does not have the preference set — which is every reviewer, by default, on every
   machine in this project.

## 📝 Proposed Solution

Implement the clause exactly as `01-S2` designed it, and make it falsifiable twice.

**1. The hook.** One declaration inside the existing `REDUCED MOTION` block:

```css
[data-motion-transform] {
  transform: none !important;
}
```

**2. The contract the attribute carries.** `data-motion-transform` means: _my transform is owned by
an animation, and my resting transform is `none`._ That is a real restriction, not documentation —
it is what makes a single, blanket `transform: none` safe — and it is why `skeleton.tsx`'s sheen,
whose resting transform is the static `-translate-x-full` that parks it off the left edge, must not
carry it. Resetting that element to `none` would drop an opaque gradient over the middle of the
skeleton, which is a regression the reduced-motion user would see and the default user would not.

**3. Five attributes.** `dialog.tsx` (the panel, covering both the centred and the docked
placements), `popover.tsx`, `tooltip.tsx`, `progress-bar.tsx` (the indeterminate fill) and
`spinner.tsx`.

**4. The runtime proof.** `e2e/reduced-motion.visual.spec.ts`, with the preference set: a frame
captured immediately after paint is byte-identical to one captured a second later, and every
`[data-motion-transform]` element on screen computes `transform: none`.

**5. The source guard.** `src/styles/__tests__/motion-transform-reset.test.ts`: every element in
`src/` applying an `animate-*` utility whose keyframes mutate `transform` either carries the hook or
carries a static transform utility of its own. The two groups are exhaustive and the test says which
one each site is in, so the next transform animation added to this product cannot be silent about it.

### Alternatives considered

| Alternative                                                          | Why it lost                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*, *::before, *::after { transform: none !important }`              | Destroys every legitimate static transform in the product — the skeleton sheen, `-translate-x-1/2` centring, icon nudges. A sweep is right for _durations_, which no element expresses a resting state through; it is wrong for `transform`, which many do.                                                                                                                                                                           |
| `animation: none !important` and drop the hook entirely              | The failure the current docblock was written to prevent: React Aria unmounts an exiting overlay on `animationend`, and an animation that never starts never ends. A dialog that cannot be closed is a worse accessibility defect than a misplaced one.                                                                                                                                                                                |
| `animation-fill-mode: none !important` in the sweep                  | Narrower and tempting, and it does neutralise the specific `forwards` regression — but it neither describes an element's resting state nor catches an element parked by anything else (a paused animation, a `transform` written by script). It also silently overrides a fill mode a future animation may legitimately need outside reduced motion. Rejected as a fix that treats one cause of parking rather than the state itself. |
| A `useReducedMotion()` hook in `src/lib/motion.ts` clearing it in JS | A preference query answered in CSS needs no JavaScript, no hydration and no re-render. `src/lib/motion.ts` is the other open blocker on `01-S2` and is deliberately out of scope here (see _Scope boundary_).                                                                                                                                                                                                                         |
| Ship the reset with no test, since nothing is visibly broken         | The issue's acceptance criterion is the opposite: _"a test proves it rather than a stylesheet asserting it."_ A preventive rule nobody asserts is the same category of artefact as the clause this spec is closing.                                                                                                                                                                                                                   |

## 📝 Architecture

### Owner module of each new concept

Per `docs/SPEC.md` §8, one owner per concept:

| Concept                                             | Owner                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| The `data-motion-transform` attribute and its reset | `src/styles/tokens.css`, inside the existing `REDUCED MOTION` block — the only place the preference is answered |
| Which elements carry it                             | The individual `src/components/ui/*.tsx` modules that apply the animation                                       |
| The rule that the two stay in agreement             | `src/styles/__tests__/motion-transform-reset.test.ts`                                                           |
| The runtime evidence                                | `e2e/reduced-motion.visual.spec.ts`                                                                             |

No new module, no new export, no new class-string constant in `src/components/ui/shared.ts`. The
hook is an attribute rather than a utility class precisely so that it cannot be composed into a
`className` string and lost in a `cn()` merge.

### Where the attribute goes, site by site

| File                                 | Element                                 | Why it qualifies                                                                                       |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/components/ui/dialog.tsx`       | the `RACModal` carrying `modalVariants` | `dialog-in`/`dialog-out` on every placement, `drawer-in`/`drawer-out` on `drawer`; rests at `none`     |
| `src/components/ui/popover.tsx`      | the `RACPopover` carrying `popMotion`   | `pop-in`/`pop-out`; the placement `origin-*` classes are transform-origin, not transform               |
| `src/components/ui/tooltip.tsx`      | the tooltip bubble                      | `pop-in`/`pop-out`; rests at `none`                                                                    |
| `src/components/ui/progress-bar.tsx` | the indeterminate fill span             | `indeterminate`, infinite; rests at `none`, which is the left-anchored third the readable clause wants |
| `src/components/ui/spinner.tsx`      | the `svg`                               | `spin`, infinite; rests at `rotate(0)`, i.e. `none`                                                    |
| `src/components/ui/skeleton.tsx`     | the sheen span — **excluded**           | `shimmer`, infinite, but its resting transform is the static `-translate-x-full` that hides it         |

`src/components/ui/shared.ts`'s `scrimSurface` animates `fade-in`/`fade-out` — opacity only — and is
not in the table. Neither is `src/components/charts/chart-frame.tsx`, whose `motion-safe:animate-fade-in`
is both opacity-only and already gated on the preference.

### The source guard's rule

Derived from the stylesheet, with no list of component names in the test — the shape
`src/styles/__tests__/token-classes.test.ts` established in this directory and documented at length
in its own docblock:

1. Parse `src/styles/app.css` for `@keyframes` blocks whose declarations mention `transform`.
2. Parse the `--animate-*` custom properties for those that reference one of those keyframes; the
   utility name is the property name minus the `--animate-` prefix.
3. Scan `src/**/*.tsx` for `animate-{name}` occurrences of those utilities, including the
   `data-[entering]:` / `data-[exiting]:` variants.
4. For each occurrence, the JSX element it sits on must either carry `data-motion-transform` or
   carry a static transform utility (`translate-*`, `-translate-*`, `rotate-*`, `scale-*`,
   `skew-*`, `transform-*`) in the same `className`.

The two branches are the two honest answers to "where does this element rest?", and the failure
message names which one the site is missing. A site that genuinely needs neither does not exist: an
element animating `transform` rests somewhere, and the guard's whole value is that the author has to
say where.

### Scope boundary

`01-S2` also owns `src/lib/motion.ts` and `src/lib/__tests__/motion.test.ts` — the shared transition
presets and the 400 ms ceiling. **They are out of scope.** That is the stage's other blocker, it was
reshaped by ADR 0019 when the `motion` package was removed, and it ships nothing this issue's
acceptance criterion asks for. Building it here would bundle two independently deployable
capabilities into one spec, which `om-spec-writing`'s scope-cohesion rule rejects. `01-S2` stays
open after this spec ships; only its `[data-motion-transform]` blocker closes.

### Shared-path note

`src/styles/tokens.css` is one of the eight shared paths that belong to `docs/plans/00-foundations.md`
and to nothing else (`docs/plans/README.md` → _The concurrency contract: waves_). That rule governs
what a **plan stage** may declare under `Owned paths`; this is an issue-driven defect fix and mints
no stage, so it does not trip it. Both plan documents already anticipate the edit and name this
issue: `00-foundations.md:314` records the reset as unimplemented under `DSY-04`, and
`01-design-system.md:253` lists it as a blocker _"tracked on its own issue"_ (#214). Phase 3 updates
both sentences rather than leaving two documents describing a gap that has been closed.

## 📝 Data Model

None. No table, no column, no migration, no stored row.

## 📝 API Contracts

None. No server function, no API route, no queue message, no Durable Object call. Nothing in this
change reaches `src/server/`, so the Zod-twice rule and the tenant-scoping rule have no surface to
apply to, and no case is added to `tenant-isolation.test.ts` or `money-invariants.test.ts`.

## 📝 UI/UX

`components/ui` gains one DOM attribute per affected primitive. No component gains a prop, a
variant, a fetch or an import from `server/`. No keyboard path, focus order, accessible name or
announcement changes: `data-*` attributes are inert to assistive technology, and React Aria's own
`data-entering` / `data-exiting` / `data-placement` attributes are untouched.

The behavioural change is visible only under `prefers-reduced-motion: reduce`, and only in states
this product cannot currently reach: the reset is a no-op against today's tree (see _Problem
Statement_) and becomes load-bearing the moment an animation parks a transform. That is the intended
shape — a defence that changes nothing until it is needed, with a test that says so.

## 📝 Visual change expected

**None.** Every affected element already rests where the reset would put it, in both preference
states.

Routes and states the browser proof captures, so the claim is tested rather than asserted:

| Route       | State                                                       | Preference | Themes       | Widths                    |
| ----------- | ----------------------------------------------------------- | ---------- | ------------ | ------------------------- |
| `/accounts` | the **New account** modal open (centred panel, `dialog-in`) | `reduce`   | light + dark | 1440×900 (`chromium`)     |
| `/accounts` | the **New account** modal open (docked panel, `drawer-in`)  | `reduce`   | light + dark | 393×852 (`mobile-safari`) |
| `/accounts` | a shell menu popover open (`pop-in`)                        | `reduce`   | light + dark | 1440×900 (`chromium`)     |

Frames are compared in-run, buffer against buffer, and never written into the repository — ADR 0016
deleted the committed-baseline file and `AGENTS.md` forbids a PNG in the tree. If a frame is needed
as PR evidence it goes to `.ai/qa/artifacts_*/`.

## 📝 Copy

**None.** No new user-facing string, so no `en`/`pl` catalogue key and no work for the
`i18n-messages` skill. The only new text this change adds is a test failure message, which is
developer-facing and stays English-only like every other assertion in the suite.

## 📝 Edge Cases & Failure Scenarios

| Case                                                                              | Behaviour                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An element carries the hook **and** a static transform utility                    | The `!important` reset wins under `reduce` and the static transform is lost. This is a mislabelling, not a CSS problem, and the source guard is what catches it — it is exactly the skeleton-sheen shape.                                                                          |
| An exiting overlay under `reduce`                                                 | Unaffected. The reset touches `transform` only; `animation-duration` still collapses to `0.01ms` and `animationend` still fires, so React Aria still unmounts. This is the invariant the whole design is built around and the e2e opening _and closing_ a dialog is what holds it. |
| A future animation adds `animation-fill-mode: forwards`                           | Under `reduce` the parked transform is overridden by the reset; outside `reduce` the fill mode behaves normally. This is the regression the change exists for.                                                                                                                     |
| A transform written by JavaScript (inline style) on a hook element under `reduce` | Overridden — `!important` in a stylesheet beats an inline declaration without `!important`. Correct for a transform that is animation choreography; wrong for one that positions the element, which is why that element must not carry the hook.                                   |
| A new transform animation lands with neither the hook nor a static transform      | `pnpm test` fails on `motion-transform-reset.test.ts`, naming the file, the utility and the two options.                                                                                                                                                                           |
| The attribute is renamed or dropped from a component                              | Two failures: the source guard on the static side, and the e2e's non-zero hook count on the runtime side. The count assertion exists so a rename cannot turn the pixel test into a vacuous pass over zero elements.                                                                |
| The browser proof flakes on a slow CI machine                                     | It compares two frames of the **same** run against each other with no stored baseline, so machine speed changes when the frames are taken and not what they contain. A genuine difference means motion is still running, which is the failure it is for.                           |
| A user agent that reports `reduce` but ignores the media query                    | Out of reach for any implementation and not claimed. `docs/ACCESSIBILITY.md` §2.3.3 already withholds the formal claim for third-party surfaces for the same class of reason.                                                                                                      |

## 📝 Risks & Impact Review

**Blast radius.** One declaration inside a media query that only applies under a preference, plus one
attribute on five components. The declaration cannot affect a default-preference user at all: it is
inside `@media (prefers-reduced-motion: reduce)`. For a `reduce` user it can only change elements
carrying an attribute that did not exist before this change.

**The one way this can regress a user.** Putting the hook on an element whose resting transform is
not `none` — the skeleton-sheen mistake — would move that element for reduced-motion users only,
where nobody reviewing the PR would see it. Mitigated three ways: the exclusion is stated in the
spec, the source guard makes the two groups explicit, and the e2e asserts computed `transform` under
the preference rather than trusting the markup.

**Compatibility.** No surface in `BACKWARD_COMPATIBILITY.md` changes. The accessibility claim is a
protected surface there and `docs/ACCESSIBILITY.md` is **not edited**: §2.3.3's "effectively met"
and the AA claim in §1 are unchanged in wording and in scope. No blanket "WCAG AAA" claim appears
anywhere in this change. No dependency is added, removed or upgraded, so the `docs/SPEC.md` §3
freeze is untouched.

**Rollback.** Revert the PR. There is no migration, no stored state, no cache to warm and no
generated artefact beyond `.ai/specs/README.md`. A partial revert is also safe: the reset with no
attributes is inert, and the attributes with no reset are inert.

**Money.** None. No amount, rate, currency or date bucket is read or written, so `docs/MONEY.md` has
no clause in play. Worth recording explicitly because `01-S2` carries a money invariant of its own —
no count-up animation on an amount — which this spec neither implements nor weakens.

## 📝 Research

`tailwindcss`'s own `motion-reduce:` variant and the widely-copied Bootstrap/`sanitize.css`
reduced-motion reset both take the sweep form this repository already ships, and both stop where it
stops — durations, iteration count, `scroll-behavior`. Neither addresses the resting-transform
problem, because both assume an author who expresses resting state in static CSS. `01-S2`'s hook is
the stricter position and is worth keeping: it makes the assumption explicit instead of hoping for it.

The WCAG 2.2 Understanding document for 2.3.3 is about motion _triggered by interaction_, and is
silent on where an element lands when that motion is suppressed. The reduced-motion literature that
does cover it — the MDN `prefers-reduced-motion` guidance and the WebKit note that introduced the
media query — consistently frames the goal as "show the end state immediately", which is precisely
what an unreset parked transform fails to do.

What the market leaders carry that this spec skips: a full motion-preset layer (Radix's
`data-state`-driven animation API, Framer Motion's `useReducedMotion`). That is `src/lib/motion.ts`,
and it is out of scope by the scope boundary above.

## 📋 Phasing

Three phases, each independently shippable and each leaving the application working.

- **Phase 1 — the reset and the hook.** The CSS declaration plus the five attributes. Ships the
  behaviour. Verified by a DOM test that each primitive renders the attribute.
- **Phase 2 — the runtime proof.** `e2e/reduced-motion.visual.spec.ts`. Ships the falsifiability the
  issue's acceptance criterion asks for.
- **Phase 3 — the drift guard and the documents.** The source guard, plus the three sentences in
  `docs/plans/01-design-system.md` and `docs/plans/00-foundations.md` that currently describe the
  clause as unimplemented.

Phase 1 alone satisfies the first half of the acceptance criterion and Phase 2 the second, so a
reviewer who wants the change split gets a coherent PR either way. Phase 3 is what stops the fix
decaying.

## 📋 Implementation Plan

### Phase 1 — the reset and the hook

1. **Add the declaration.** In `src/styles/tokens.css`, inside the existing
   `@media (prefers-reduced-motion: reduce)` block and after the `*` sweep, add
   `[data-motion-transform] { transform: none !important; }` with a docblock that states the
   attribute's contract ("my transform is owned by an animation; my resting transform is `none`"),
   why the reset is not a blanket `*` rule, and why `!important` is needed to reach utilities and
   third-party rules declared later in the cascade. Match the existing comment density of that file.
   → **verify:** `pnpm lint` and `pnpm build` pass; a scratch page with the preference set shows an
   element carrying the attribute computing `transform: none`.

2. **Attribute the five primitives.** Add `data-motion-transform` to the `RACModal` in
   `src/components/ui/dialog.tsx`, the `RACPopover` in `src/components/ui/popover.tsx`, the bubble
   in `src/components/ui/tooltip.tsx`, the indeterminate fill span in
   `src/components/ui/progress-bar.tsx` and the `svg` in `src/components/ui/spinner.tsx`. Do not
   touch `src/components/ui/skeleton.tsx`; add one sentence to its existing docblock recording
   _why_ the sheen is excluded, so the next reader does not "fix" the omission.
   → **verify:** `pnpm typecheck`, `pnpm lint`.

3. **Assert the markup.** Add cases to the `ui`-project tests for the five components asserting the
   rendered element carries the attribute, and one case asserting the skeleton sheen does not.
   Extend the existing `__tests__` files for those components rather than adding a new file per
   component.
   → **verify:** `pnpm test` green, and each new case fails when its attribute is removed.

### Phase 2 — the runtime proof

4. **Write `e2e/reduced-motion.visual.spec.ts`.** Import `expect`/`test` from `./support/console` so
   a console error fails the run (ADR 0016), and `gotoApp` / `storageStateFor` from the existing
   support modules. Build the context with `reducedMotion: 'reduce'`, sign in as the `demo` session,
   open `/accounts`, activate **New account**, and wait for `page.getByRole('dialog')` to be visible.
   → **verify:** `pnpm e2e -- reduced-motion` opens the dialog on `chromium` and `mobile-safari`.

5. **Assert pixel identity.** Capture `page.screenshot()` immediately after the dialog is visible and
   again after a 1 s wait, and assert the two buffers are equal. No stored baseline, no file written
   into the repository. Add the same pair for a popover opened from the shell.
   → **verify:** the assertion passes as written, and fails when the `reducedMotion: 'reduce'` option
   is removed from the context and a long-running animation is temporarily forced — recorded in the
   PR as the falsification check, not left in the file.

6. **Assert the computed transform and the hook count.** In the same file, read every
   `[data-motion-transform]` in the open dialog's subtree, assert the count is greater than zero, and
   assert each computes `transform: none`. Repeat in both themes via the existing `useTheme` helper.
   → **verify:** the count assertion fails when the attribute is removed from `dialog.tsx`, which is
   what makes the pixel test non-vacuous.

7. **Close the dialog and assert it unmounts.** Press `Escape` and assert the dialog is detached.
   This is the regression guard for the reason the sweep collapses durations instead of killing
   animation: if the reset ever interfered with `animationend`, this is the assertion that goes red.
   → **verify:** `pnpm e2e` green on all three browser projects.

### Phase 3 — the drift guard and the documents

8. **Write `src/styles/__tests__/motion-transform-reset.test.ts`.** Implement the four-step rule from
   _Architecture → The source guard's rule_: derive the transform-mutating keyframes from
   `src/styles/app.css`, derive the utilities that reference them, scan `src/**/*.tsx` for those
   utilities, and assert each site carries either the hook or a static transform utility. Document
   the limits in a docblock the way `token-classes.test.ts` does — an interpolated class name is
   invisible to a source scan, and saying so is part of the test.
   → **verify:** `pnpm test` green; the test goes red when the attribute is removed from
   `popover.tsx`, and stays green when the skeleton sheen keeps its `-translate-x-full`.

9. **Update the plan documents.** In `docs/plans/01-design-system.md`, rewrite the `[data-motion-transform]`
   blocker entry and the `Accessibility` clause of `01-S2` to record the reset as shipped, naming
   this issue and the implementing PR, and leave the stage open on its remaining `src/lib/motion.ts`
   blocker. In `docs/plans/00-foundations.md`, update the `DSY-04` sentence that currently reads
   _"is **not** implemented and stays open there"_. Append an `## Amendment` section to this spec if
   anything shipped differently from this design.
   → **verify:** `pnpm exec vitest run --project=tooling scripts/plans` green, and the full gate.

### Definition of done

- The seven-row inventory in _Problem Statement_ still describes the tree, with the "Parks wrong
  today?" column still reading **No** for every row — now because something enforces it.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` green, and the three generated-artefact
  diffs empty.
- `pnpm e2e` green on `chromium`, `mobile-safari` and `webkit`, with zero console errors.
- Removing the attribute from any one of the five primitives turns the suite red — demonstrated, not
  assumed.
- `docs/ACCESSIBILITY.md` byte-identical.
- No PNG added to the repository.

## 📝 Resolved assumptions (autonomous defaults)

`om-auto-write-spec` ran unattended and resolved each Open Question to the most reversible,
smallest-scope answer. Every row is a decision a human can overturn before the spec PR merges.

| #   | Question                                                                                                  | Resolved as                                                                                                                                       | Why                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Does reduced motion reset `transform` on everything, or only on an opt-in `[data-motion-transform]` hook? | The opt-in hook, exactly as `01-S2` designed it.                                                                                                  | A blanket reset destroys every legitimate static transform, starting with the skeleton sheen. Re-deciding a designed mechanism is also not this issue's business.      |
| Q2  | Is `src/lib/motion.ts` — `01-S2`'s other open blocker — in scope?                                         | No. Out of scope, stage stays open on it.                                                                                                         | Two independently deployable capabilities in one spec is the bundle the scope-cohesion rule rejects, and ADR 0019 reshaped that blocker after `01-S2` was written.     |
| Q3  | Does the browser proof assert only `01-S2`'s pixel identity, or also the computed transform?              | Both, in the same file.                                                                                                                           | Pixel identity proves motion stopped; only the computed transform proves it stopped in the _right place_, which is this issue's actual subject.                        |
| Q4  | Does a static drift guard ship, and how does a legitimately-transformed element escape it?                | Yes, Phase 3, with the escape derived from the source — a static transform utility in the same `className` — and no allowlist of component names. | `token-classes.test.ts` in the same directory established that an allowlist masks exactly the sites most likely to be wrong. Deriving the rule keeps the guard honest. |
| Q5  | Does `docs/ACCESSIBILITY.md` change?                                                                      | No. Not one byte.                                                                                                                                 | The claim is a protected surface in `BACKWARD_COMPATIBILITY.md` and §2.3.3 already reads "effectively met". This change makes the existing sentence true, not wider.   |
| Q6  | Does the reset carry `!important`?                                                                        | Yes.                                                                                                                                              | Same reason the sweep above it does: it must reach utilities and third-party rules declared later in the cascade. Recorded as a trade-off in the _Edge Cases_ table.   |
| Q7  | Are any new user-facing strings needed?                                                                   | None.                                                                                                                                             | Nothing user-visible is added, so the EN + PL catalogue is untouched.                                                                                                  |
| Q8  | Which browser projects does the proof run on?                                                             | All three the config defines; the `drawer` placement is only reachable on `mobile-safari`.                                                        | The docked panel is the case the issue names — a resting position expressed through a full-height `translateY` — and it exists only at the mobile viewport.            |

No assumption carries `⚠ NEEDS HUMAN CONFIRMATION`: none of the eight weakens security, tenant
scoping, a `BACKWARD_COMPATIBILITY.md` surface, the accessibility claim, or a decision recorded in
an ADR.

## Amendment — PR #416

Phase 2 shipped differently from the design above in five places, each measured on that PR. Phase 3
in PR #419 closes the source-guard and documentation work without changing those deviations.

1. **"At rest" is read from state, not from frames.** ADR 0016 keeps every screenshot comparison
   out of CI, a comparison made inside the run included, so the frame pair became a state pair: no
   animation or transition in the document still running for longer than the sweep's 0.01ms, and
   the overlay's box and opacity equal to what they read a second later. With the whole
   reduced-motion block disabled every case went red, naming `dialog-in`, `pop-in`, `drawer-in` and
   `fade-in` as still running.
2. **The transform reset is read with the entrance held at its first keyframe.** After an entrance
   finishes nothing sets a `transform` on a hooked element, so a read at rest is `none` with or
   without the reset. The spec restarts the element's own entrance through `data-entering`, pauses
   it at `currentTime` 0 and reads the transform there; with the reset deleted every case went red
   (`matrix(0.985, 0, 0, 0.985, 0, 8)` on the modal, `matrix(1, 0, 0, 1, 0, 285)` on the sheet).
   The count assertion counts hooks that have an entrance to hold, and went red on every modal and
   sheet case with the hook removed from `RACModal`.
3. **The first reading is taken two animation frames after the overlay is visible**, not
   immediately. The `*` sweep shortens a colour transition started by the same state change to
   0.01ms without removing it, and it lands on the next frame; two frames are far too short for any
   animation to finish.
4. **The docked case is the bottom navigation's More sheet**, not the **New account** modal. The
   account form is centred at every width (tracking plan, correction 2), so the modal is proved
   centred on every project and the sheet on the phone projects. The popover is the shell's
   Appearance menu on the desktop projects.
5. **Four browser projects, not three.** The config now defines `mobile-chromium` as well (issue
   #317), which supersedes Q8: the sheet runs on both phone projects and the modal on all four.
