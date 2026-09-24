# Execution plan — reduced motion: the `[data-motion-transform]` reset (issue #214)

Source doc: .ai/specs/2026-09-11-reduced-motion-transform-reset.md
Tracking issue: #214
Spec PR: #251 (merged 2026-09-11)

## Goal

Ship the third clause of `01-S2`'s reduced-motion contract - reset `transform` on
`[data-motion-transform]` under `prefers-reduced-motion: reduce` - and the two tests that make it
falsifiable: a browser proof that a parked element is still and at rest, and a source guard that a
new transform animation cannot land without saying where its element rests.

## Scope

In scope: `src/styles/tokens.css` (one declaration inside the existing `REDUCED MOTION` block), the
five primitives the spec names (`dialog.tsx`, `popover.tsx`, `tooltip.tsx`, `progress-bar.tsx`,
`spinner.tsx`), one docblock sentence in `skeleton.tsx`, their `ui`-project tests,
`e2e/reduced-motion.visual.spec.ts`, `src/styles/__tests__/motion-transform-reset.test.ts`, the
sentences in `docs/plans/01-design-system.md` and `docs/plans/00-foundations.md` that describe the
reset as unimplemented, and the spec's lifecycle bookkeeping.

**Non-goals**, restated from the spec so a reviewer can check the diff against them:

- `src/lib/motion.ts` and `src/lib/__tests__/motion.test.ts` - `01-S2`'s other blocker. The stage
  stays open on it.
- Any byte of `docs/ACCESSIBILITY.md`.
- Any dependency change. The guard uses `typescript`, which is already a devDependency (6.0.3 from
  `node -e "console.log(require('typescript/package.json').version)"`).
- Any user-facing copy, schema, repository or server function.
- Any change to the `*` duration sweep or to `animation-fill-mode` on any utility.

## Corrections measured before implementation

Each of these is a place where the tree disagrees with the spec. They ship as an `## Amendment` on
the spec rather than as a silent divergence.

1. **Tailwind v4 does not compile static transform utilities to `transform`.** Compiling
   `-translate-x-full`, `scale-95`, `rotate-180`, `skew-x-3` and `transform-gpu` with the installed
   `tailwindcss` 4.3.3 gives `translate:`, `scale:` and `rotate:` for the first three and
   `transform:` only for `skew-*` and `transform-*`. So `transform: none !important` would **not**
   move the skeleton sheen off `-translate-x-full`, and the spec's Edge Cases row "the static
   transform is lost" holds only for `skew-*` / `transform-*`. The sheen's exclusion still stands,
   on the attribute's contract ("my resting transform is the identity") rather than on a visible
   regression.
2. **The "New account" modal is centred at every width.** `FormModal` never passes `placement`, and
   the only `drawer` in the product is the bottom navigation's "More" sheet
   (`src/components/app/nav/bottom-nav.tsx`, through `Drawer side="bottom"`). The docked-panel case
   on `mobile-safari` is therefore proved on that sheet, not on the account form.
3. **A per-JSX-element text scan of `src/**/*.tsx` cannot see two of the five sites.** `popover.tsx`
   applies `pop-in` through `popMotion`, a constant in `src/components/ui/shared.ts`, and
   `dialog.tsx` through `modalVariants`, a `cva` constant. The guard resolves module-level constants
   to the `className` that consumes them, on the TypeScript AST, so it can go red for `popover.tsx`
   as the spec's verify step requires.
4. **`DSY-05` cannot move to `→ done`.** It is `01-S2`'s only reference row, and `01-S2` still
   declares `src/lib/motion.ts — new`, which is absent; assertion 2 of the plan guard requires such
   a stage to keep an open row. The row's prose is corrected and its status is left open.
5. **Only `dialog.tsx` has a test file of its own.** Popover is exercised only inside
   `menu.test.tsx`, and tooltip, progress bar, spinner and skeleton have none. The markup cases for
   those five go into one new file rather than one per component.

## Implementation Plan

### Phase 1 - the reset and the hook

1. Add `[data-motion-transform] { transform: none !important; }` inside the existing reduced-motion
   media block, after the `*` sweep, with a docblock stating the attribute's contract.
2. Put `data-motion-transform=""` on the `RACModal`, the `RACPopover`, the `RACTooltip`, the
   progress bar's fill and the spinner's `svg`; add one sentence to `skeleton.tsx` recording why
   the sheen does not carry it.
3. Assert the markup in the `ui` project: each of the five renders the attribute, the skeleton sheen
   does not.

### Phase 2 - the runtime proof

4. `e2e/reduced-motion.visual.spec.ts` with `reducedMotion: 'reduce'` on the context, the demo
   session, `/accounts`.
5. Pixel identity: a frame after the overlay is visible equals a frame one second later, for the
   account dialog and the theme menu popover (desktop projects) and the "More" sheet
   (`mobile-safari`).
6. Every hooked element computes `transform: none`, and the overlay's own hook is present (a count,
   so a renamed attribute cannot make the pixel test vacuous), in light and dark.
7. Escape closes the overlay and it detaches - the `animationend` regression guard.

### Phase 3 - the drift guard and the documents

8. `src/styles/__tests__/motion-transform-reset.test.ts`: derive the transform keyframes and their
   `--animate-*` utilities from `app.css`, find every `className` in `src/` that applies one
   (following module-level constants), and require the hook or a static transform utility.
9. Update `docs/plans/01-design-system.md` (the `DSY-05` prose, the Accessibility clause, the
   blocker entry) and the `DSY-04` sentence in `docs/plans/00-foundations.md`.
10. Spec lifecycle: `Status: in-progress` and the `## Amendment` section; regenerate the spec index.
11. The full gate.

## Risks

- **A hook on an element positioned by an inline `transform`.** Overridden under `reduce`. React
  Aria positions popovers and tooltips with `top`/`left`, not `transform`; the e2e asserts computed
  `transform` on the real overlays.
- **Pixel identity flaking on a moving page.** Two frames of the same run, no stored baseline; the
  caret is hidden by Playwright's screenshot default. A genuine difference is motion still running.
- **The e2e is not in the local validation gate.** CI runs it on every pull request; it is run
  locally against `.ai/scripts/test-env-up.sh` before the PR is marked ready.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The reset and the hook

- [x] 1.1 Add the declaration — e089d9f
- [x] 1.2 Attribute the five primitives — 96bc950
- [x] 1.3 Assert the markup — 5ede183

### Phase 2: The runtime proof

- [x] 2.1 Write the reduced-motion spec — 5e42de9
- [x] 2.2 Assert pixel identity — 5e42de9
- [x] 2.3 Assert the computed transform and the hook count — 5e42de9
- [x] 2.4 Close the overlay and assert it detaches — 5e42de9

### Phase 3: The drift guard and the documents

- [ ] 3.1 Write the source guard
- [ ] 3.2 Update the plan documents
- [ ] 3.3 Spec lifecycle bookkeeping
- [ ] 3.4 The full gate
