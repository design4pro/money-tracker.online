# Modal windows: bound the panel to the viewport, and refuse to discard a touched form

## 📝 TLDR

A centred dialog in this repository has no height bound, so a form longer than the viewport grows
past it and the **scrim** scrolls instead of the dialog body. Because the scrim centres its child,
the part of the panel above the top edge is not reachable by any scroll gesture: the title, the lead
line and the close control are simply gone. The compensation shipped for that was
`isDismissable={false}` on eleven call sites - a dialog you cannot dismiss by pressing away from it,
ever, even when you have typed nothing. This spec bounds the panel to the viewport so `DialogBody`
becomes the scroll port it was already written to be, and replaces the blanket `isDismissable={false}`
with a guard that closes a pristine dialog on a scrim press and answers a dirty one with an
`alertdialog` about unsaved changes. No server module is touched, no migration runs, no dependency is
added. Three phases; **phase 1 ships as its own pull request**, phases 2-3 as a second.

## 📝 Problem Statement

### 1. The panel has no height bound, and the header pays for it

`src/components/ui/dialog.tsx` builds the overlay/panel pair. The panel's `cva` (`dialog.tsx:24-55`)
gives `placement: 'center'` exactly one class, `rounded-xl`. There is no `max-height` anywhere on that
branch. The scrim (`dialog.tsx:95-100`) is `flex p-4` plus `items-center justify-center overflow-y-auto`
for the non-docked case. So when the panel is taller than the viewport the scrim becomes the scroll
container and the panel is its centred child - and **a centred flex child cannot be scrolled back to
in the block-start direction**. The overflow above the scroll origin has no scroll range mapped to it.

Measured on the static reproduction committed beside this spec
(`.ai/specs/assets/modal-scroll-and-unsaved-guard/mockup-01-center-dialog-desktop.html`, probed with
`getBoundingClientRect` in headless Chromium):

| Simulated viewport | Panel height | Scrollable below | Above the scroll origin, unreachable |
| ------------------ | ------------ | ---------------- | ------------------------------------ |
| 900 × 470 desktop  | 723px        | 144px            | **128px** - the whole `DialogHeader` |
| 360 × 640 phone    | 723px        | 59px             | **43px** - the title's first line    |

The rendered frames are attached to this spec's pull request rather than committed, because
`AGENTS.md` → Never forbids leaving a PNG in the repository; the `.html` sources beside this spec
reproduce them with no build step. The left column of each is today's rule set, and nothing in either
box is scrolled. The numbers come from a static reproduction of the rules, not from `/accounts` -
Step 1.1 re-measures on the real surface.

### 2. The scroll port that exists is switched off

`DialogBody` (`dialog.tsx:191-207`) is already written as the scroll port, with the right classes and
a comment naming the criterion it reserves room for:

> `'min-h-0 flex-1 overflow-y-auto px-5 py-4 focus-safe'` - _"The scrollable region of a dialog, and
> therefore the one that has to reserve room so a focused control at its edge is not clipped (WCAG 2.2
> §2.4.12)."_

It never becomes a scroll port for a centred dialog, and the reason is one class. `Dialog`
(`dialog.tsx:123`) is `flex max-h-[inherit] flex-col outline-hidden`. `max-height: inherit` takes the
**computed** `max-height` of the parent; for `placement: 'center'` the parent sets none, so it computes
to `none`, so `DialogBody`'s `flex-1` has an unbounded column to fill and `overflow-y-auto` never has
anything to do. The two docked placements do have a bound - `max-h-[92dvh]` at `dialog.tsx:48` and
`h-full` at `dialog.tsx:50` - which is why the bottom sheet and the side drawer behave and the centred
dialog does not. The bug is not in `DialogBody`. It is one missing bound, three lines up.

### 3. It is an AA failure by the repository's own probe

`.github/a11y/axe-scan.mjs:229-238` classifies a focused control with **all four corners** covered or
off-screen as **2.4.11 Focus Not Obscured (Minimum)** - a **Level AA** criterion, met as part of the
AA claim in `docs/ACCESSIBILITY.md` §3.3 - and a partial cover as the AAA 2.4.12. A close button
sitting 128px above the scroll origin is four corners off-screen, so this is an AA failure, not
merely an AAA one.

The probe cannot see it. `grep -niE 'dialog|modal' .github/a11y/axe-scan.mjs` returns nothing: it
walks routes and never opens an overlay. The failure lives on the one surface the verifier does not
reach. This spec does not widen the accessibility claim and does not edit `docs/ACCESSIBILITY.md`; it
removes a way of failing a claim the repository already makes. Extending the probe into dialogs is
named in Phasing as deferred work, so the gap is recorded rather than closed by silence.

### 4. `isDismissable={false}` is a workaround wearing a rationale

`Modal` defaults `isDismissable` to `true` and the comment above it (`dialog.tsx:74-78`) draws the
line the product wants:

> _"`isDismissable` defaults to `true` here, and should be turned OFF for any dialog that would lose
> the user's work - a half-finished transaction, an import mapping. An accidental click on the scrim is
> not consent to discard."_

The premise is right and the mechanism is blunt. `grep -rl 'isDismissable={false}' src/` returns
**eleven files**: nine form dialogs (`account-form-dialog`, `adjust-balance-dialog`,
`budget-form-dialog`, `category-form-dialog`, `contribution-dialog`, `goal-form-dialog`,
`payee-form-dialog`, `refund-dialog`, `series-form-dialog`), the transactions filter drawer
(`filter-bar.tsx:388`) and one destructive confirmation (`confirm-delete-dialog.tsx:49`). In all
eleven the flag is a literal `false`: an empty _New budget_ form that the user opened by mistake is
exactly as unclosable as one they have half filled. The scrim stops being a control and starts being
a wall, and the only way out is a close button that - per problem 1 - may be off screen.

"An accidental click on the scrim is not consent to discard" is a statement about a form with work in
it. Nothing about it is true of a form with nothing in it, and the code cannot currently tell the two
apart.

## 📝 Proposed Solution

Three moves, each shippable alone.

**A. Bound the panel; let the body scroll.** `placement: 'center'` gets
`max-h-[calc(100dvh-2rem)]` - the viewport less the scrim's `p-4` on both edges - and the panel
becomes a flex column. `Dialog` drops `max-h-[inherit]` for `min-h-0 flex-1`, so it is a flex item of
that column rather than a size that has to be inherited through it. `DialogHeader` and `DialogFooter`
get `shrink-0`. `DialogBody` is not touched: it already does the right thing the moment its column is
bounded. The scrim keeps `overflow-y-auto` but swaps `items-center` for a `my-auto` on the panel,
which centres when the panel fits and collapses to zero when it does not - the documented way to keep
the block-start overflow reachable in the residual case where a panel refuses to shrink.

**B. Give `Modal` a refusable close.** One optional prop, no new dependency, no behaviour change for
anyone who does not pass it:

- `canClose?: () => boolean` - consulted before every close React Aria routes through `close()`; a
  `false` return means the dialog stays open.

**C. Compose it in the app layer as `FormModal`.** `components/ui` holds no user-facing copy - the
precedent is `DialogHeader`'s `closeLabel`, a prop with the comment _"Localised by the caller"_
(`dialog.tsx:131-132`). So the guard's copy lives one layer up. `FormModal` is a `Modal` that takes
**`isDirty: boolean` from its caller**, refuses the close while it is true, and raises an
`alertdialog` with the two answers that press left open: **Keep editing** (focused) and **Discard
changes**. Source: `mockup-03-unsaved-changes-alert.html`.

### The alternative that lost, and why it matters

The first draft of this spec detected "touched" centrally, inside `Modal`, from `input` and `change`
events captured on the panel - zero wiring at any call site, and a literal reading of the request's
word. **It does not work**, and the way it fails is silent:

- A React Aria `Select`, `ComboBox` or `DatePicker` renders its listbox or calendar in a `Popover`
  that is portalled **outside** the panel, so nothing a user does in it bubbles through a listener on
  the panel.
- Committing a `Select` runs `state.setSelectedKey`. Its `HiddenSelect` mirrors the value for form
  submission and autofill; it is not a user `change` event dispatched at the DOM.

`account-form-dialog` alone puts category, currency and the opening date behind exactly those three
components. A user who changed only the currency would be read as pristine and lose the change to a
scrim press - which is the precise data-loss mode this spec exists to prevent. A guard whose failure
mode is "silently stops guarding" is worse than no guard, because the wall it replaced at least held.

So the dirtiness signal is **the caller's**, computed from the state the caller already owns:

- Six of the nine form dialogs hold one `draft` object with a `patch()` setter
  (`account-form-dialog.tsx:136,150` and the same pair in `budget-`, `category-`, `goal-`, `payee-`,
  `series-form-dialog`). For those, one shared hook - `useIsDirty(draft)`, comparing each key against
  a first-render snapshot with `Object.is` - is a one-line call site.
- The other three (`adjust-balance-dialog`, `contribution-dialog`, `refund-dialog`) hold two to four
  separate `useState` fields and write their own boolean expression.

The cost is nine small expressions instead of zero. What it buys is a signal no portal can hide from,
an end to the false ask after an edit-and-revert, and - the part that turns out to matter most - the
ability for a dialog to say **"the work is saved, I am no longer dirty"**, which is what makes the
success paths in Edge Cases work at all.

## 📝 Architecture

Three files change, one is new, ten call sites are adopted.

```
src/components/ui/dialog.tsx              modalVariants + Dialog/Header/Footer classes   (A)
                                          Modal: `canClose`                              (B)
src/components/app/shell/form-modal.tsx   new - FormModal, useIsDirty, the alert         (C)
src/lib/i18n/messages/en.ts               four new `dialog.unsaved.*` keys
src/lib/i18n/messages/pl.ts               the same four keys
<ten call sites>                          drop `isDismissable={false}`, pass `isDirty`
```

**Owner module of the new concept** (`docs/SPEC.md` §8). "Unsaved-changes guard" is owned by
`src/components/app/shell/form-modal.tsx` and nowhere else. `components/ui/dialog.tsx` owns only the
mechanism - "may I close" - and stays free of copy, of state, and of any opinion about what a refusal
means.

**The interception point.** Every close React Aria performs on a dialog - a press on the scrim,
Escape, and the `close` from the `Dialog` render props, which is what `DialogHeader`'s X and every
footer button in this repository already call - ends in the overlay state's `close()`. On a
**controlled** overlay that calls `onOpenChange(false)` and changes nothing itself. `Modal` therefore
wraps the caller's `onOpenChange` once, and one wrapper covers every path:

```tsx
function handleOpenChange(next: boolean) {
  if (!next && canClose && !canClose()) return
  onOpenChange?.(next)
}
```

Two consequences, both load-bearing:

1. **`canClose` only holds for a controlled `Modal`.** Inside a `DialogTrigger` the state is React
   Aria's own and closes whatever the wrapper returns. `FormModal` therefore requires `isOpen` and
   `onOpenChange` in its prop types. Nine of the ten adopters already pass both; `filter-bar.tsx` is
   the exception and converts (Step 3.2).
2. **There is no unguarded `close()`.** A footer button that commits work and then calls the
   render-prop `close()` meets the guard like any other close. Two call sites do exactly that -
   `filter-bar.tsx`'s _Apply_ and _Reset filters_ (`filter-bar.tsx:603-620`) and
   `adjust-balance-dialog.tsx`'s _Done_ (`:254-256`, shown only after a **successful money write**) -
   and both are handled explicitly in the plan rather than assumed away. The general rule: a control
   that has just committed the work either closes through the route's own `onOpenChange(false)`, or
   the state it committed makes `isDirty` false. Both forms are used below; neither is left to chance.

**The alert.** A second `Modal` at `size="sm"` with `role="alertdialog"`, `hideClose` and
`isDismissable={false}`, rendered by `FormModal` inside the guarded dialog, which is React Aria's
documented nesting: the inner overlay takes the focus trap, the outer stays mounted and keeps every
value. Escape on the alert answers _Keep editing_; there is no third answer, and no X, because an
alert with a dismiss control has three answers and only two of them are labelled.

## 📝 Data Model and API Contracts

None. Nothing crosses `src/server/`; no table, migration, server function, queue job or route.
`components/ui` is not a surface in `BACKWARD_COMPATIBILITY.md`, and `canClose` is optional, so no
existing call site changes meaning.

## 📝 UI/UX

The frame keeps every rule `DESIGN.md` → _Dialogs and drawers_ names. The only change is that the
header and footer stay put while the body scrolls under them - which is what those two `border-subtle`
rules were drawn to mark.

Three illustrative statics live in `.ai/specs/assets/modal-scroll-and-unsaved-guard/`. They are
self-contained HTML with no build step and no app code; open one in a browser, or read the frames
attached to this spec's pull request (no PNG is committed, per `AGENTS.md` → Never).

- `mockup-01-center-dialog-desktop.html` - 900 × 470, current vs proposed, light and dark.
- `mockup-02-center-dialog-mobile.html` - 360 × 640, current vs proposed, plus proposed in dark.
- `mockup-03-unsaved-changes-alert.html` - the blocked dismiss, light and dark.

Flow, in the order a user meets it:

1. Dialog opens. Nothing is changed. A press on the scrim, Escape, the X or _Cancel_ closes it, as any
   of them would close a menu.
2. The user changes any value away from the one the dialog opened with. The dialog is now dirty.
3. A press on the scrim, Escape, the X or _Cancel_ now closes nothing. The alert opens over the form.
4. **Keep editing** - the alert closes, focus returns to the element that was focused before it opened,
   the form is exactly as it was. **Discard changes** - both close, the route's `onOpenChange(false)`
   runs, nothing is written.
5. A control that has just committed the work does not ask. Either it closes through the route's own
   `onOpenChange(false)`, or the commit is part of what `isDirty` is computed from. Saving is not
   discarding.

### Accessibility

- The alert is `role="alertdialog"`, named by its `Heading slot="title"` and described by its body -
  the pair React Aria points `aria-labelledby` and `aria-describedby` at.
- Initial focus is **Keep editing**, the non-destructive answer.
- Everything here is answerable from the keyboard alone; nothing in this change has a pointer-only
  path.
- **WCAG 2.2 §2.4.11 Focus Not Obscured (Minimum)**, AA: phase 1 is what makes it true on this
  surface (Problem 3).
- **§3.3.4 Error Prevention (Legal, Financial, Data)**, AA: the guard adds a confirmation to a class
  of data loss that currently has none. `docs/ACCESSIBILITY.md` mentions 3.3.4's AA status only in
  passing, inside the §4 row for the AAA 3.3.6; no claim anywhere is widened by this change and the
  document is not edited.
- The alert reuses existing tokens only and introduces no colour, so the AA contrast floor holds in
  both themes by construction; Step 3.3 photographs it in both anyway.

## 📝 Visual change expected

Light and dark, 360 and 1280, per ADR 0016 and `scripts/visual/capture.mjs`.

| Route / surface                                 | State to capture                                         | What moves                                                                 |
| ----------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `/accounts` → _New account_ / _Edit account_    | open, long form, 360 × 640 and 1280 × 720                | Header and footer pinned; body scrolls; submit on screen without scrolling |
| `/budgets` → _New budget_                       | open, and open with one field changed then a scrim press | Second frame is the new alert                                              |
| `/recurring` → _New series_ (the longest form)  | open, 360 × 640                                          | The clearest case: today the panel is taller than two phone viewports      |
| `/categories`, `/goals`, `/payees` form dialogs | open, 1280 × 720                                         | Same bound, no other change                                                |
| `/transactions` → filter drawer (`drawer-end`)  | open, 360 and 1280                                       | Regression check on a docked placement; dismiss behaviour changes          |
| Bottom nav → _More_ sheet (`drawer`, bottom)    | open, 360 × 640                                          | Regression check only - phase 1 touches the shared cva base                |
| `/transactions` → delete confirmation           | open                                                     | **No change** - out of scope, keeps `isDismissable={false}`                |

Backend-only surfaces: none in this change.

## 📝 Copy

Four new keys, EN and PL landing in the same change per the `i18n-messages` skill. They sit in a new
`/* -- Dialogs -- */` block after the `action.*` block in both catalogues. No plural, no
interpolation, no stored row references them.

| Key                          | `en`                                                                                 | `pl`                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `dialog.unsaved.title`       | Unsaved changes                                                                      | Niezapisane zmiany                                                                        |
| `dialog.unsaved.body`        | This form has changes that have not been saved. Close it now and they are discarded. | Ten formularz zawiera zmiany, które nie zostały zapisane. Zamknięcie go teraz je odrzuci. |
| `dialog.unsaved.discard`     | Discard changes                                                                      | Odrzuć zmiany                                                                             |
| `dialog.unsaved.keepEditing` | Keep editing                                                                         | Wróć do edycji                                                                            |

No existing key changes. `action.cancel` and `action.close` keep their current meanings and call
sites.

## 📝 Edge Cases & Failure Scenarios

| Case                                                                    | Behaviour                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A field is changed and then changed back                                | Not dirty; the dialog closes without asking. A value comparison has no memory of the trip.                                                                                                                                                                      |
| `adjust-balance-dialog` after a successful adjustment                   | Its footer swaps to a single _Done_ (`:254-256`) once `result !== null`. `isDirty` is computed as `result === null && …`, so the write that already happened is not offered for discard. **This one writes money and is called out in Step 3.1 by name.**       |
| `filter-bar`'s _Apply_ and _Reset filters_                              | Both commit through `onViewChange` and then close (`:603-620`). Step 3.2 rewires them to the route's own `onOpenChange(false)`, the unguarded path, because the work is committed by the time they run.                                                         |
| A panel that cannot shrink below the viewport (a hard `min-h` inside)   | The scrim still scrolls, but with `my-auto` instead of `items-center` the block-start overflow is reachable. Degraded, not broken.                                                                                                                              |
| The on-screen keyboard opens on a phone                                 | `dvh` is the dynamic unit, so the bound shrinks with the visual viewport and the body gets a shorter scroll port.                                                                                                                                               |
| A dialog opened from a `DialogTrigger` rather than controlled state     | `canClose` cannot hold; `FormModal`'s prop types make `isOpen`/`onOpenChange` required so the case cannot be written by accident. `Modal` itself is unchanged for these callers.                                                                                |
| Submit fails server-side and the dialog stays open                      | The failure banner renders in the body, the draft still differs from its snapshot, so the guard still holds. Nothing here changes that.                                                                                                                         |
| A nested overlay inside a dialog - a `Select`, a `DatePicker`, a `Menu` | Escape closes the inner overlay first (React Aria's stack), so the guard is not consulted. Their edits reach `isDirty` through the caller's own state, not through the DOM - see the rejected alternative.                                                      |
| A `draft` field holding an object (`CalendarDate`, `Minor`)             | `useIsDirty` compares per key with `Object.is`, so a value must be a primitive or referentially stable while unchanged. That holds for every current draft; the hook's doc comment states the contract, and a violation over-reports rather than under-reports. |
| The alert itself is dismissed by a scrim press                          | It has no dismissable scrim: `isDismissable={false}`, `hideClose`. Two answers, both buttons, plus Escape meaning _Keep editing_.                                                                                                                               |
| `prefers-reduced-motion`                                                | Inherited from the existing entrance animations; nothing new animates.                                                                                                                                                                                          |

## 📝 Risks & Impact Review

**Blast radius.** One primitive file plus ten call sites, all client-side, all render-path. Everything
that opens a dialog is affected by phase 1, which is why phase 1 ships as its own pull request and is
verified on its own - including the two docked placements whose classes it touches through the shared
cva base.

**The one behaviour regression a reviewer should look for.** Ten dialogs become dismissable that were
not. The guard is only as good as each call site's `isDirty` expression, and a wrong one is silent in
the dangerous direction. This is why the signal was moved to the caller (where the state is) rather
than sniffed from the DOM (where three of this repository's own components hide it), why the two
commit-then-close call sites are named individually in the plan instead of swept into "and the rest",
and why Step 2.3 and Step 3.2 drive real routes in a browser rather than asserting on a mock.

**Rollback.** Phase 1 is one commit and restores three class strings. Phases 2-3 are a second pull
request; reverting it restores `isDismissable={false}` at the call sites and can be done with phase 1
left in place. Step 3.2 is the one part that is a refactor rather than a flag flip -
`filter-bar.tsx` moves from `DialogTrigger` to controlled state - so it gets its own commit. There is
no persisted state, no migration and no feature flag to unwind.

**Not affected.** `src/server/**` in its entirety, the ledger, the queue, billing, auth. No money is
formatted, parsed or arithmetic'd anywhere in this change, so `docs/MONEY.md` is not engaged.

**Cost of not doing it.** The forms that most need a long form - recurring series, budgets, accounts -
are the ones whose title is off screen on a phone today.

## 📝 Resolved assumptions (autonomous defaults)

| #   | Question                                                                                        | Resolution                                                                                                                                 | Why                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Layout and guard are independently deployable - two specs or one?                               | **One spec, two pull requests.** Phase 1 lands alone; phases 2-3 land as a second PR.                                                      | They share one 223-line primitive and one problem statement, so one document is cheaper to read; they have disjoint risk profiles, so one review context each is safer. The fresh-context review of this spec argued for a full split into `modal-viewport-bound` and `unsaved-changes-guard` - **the dissent is recorded here and is a one-command change if a human prefers it.** |
| Q2  | What is "dirty" - any interaction with a control, or a value that differs from the initial one? | **A value that differs.** Computed by the caller from the state it already owns.                                                           | The request's word was "touched", and the first draft of this spec read it literally, from DOM events on the panel. That cannot see a `Select`, `ComboBox` or `DatePicker` - their popovers portal outside the panel and they commit through state, not a dispatched `change`. See _The alternative that lost_. **This resolution was changed by the review, not defaulted.**       |
| Q3  | Which close paths does the guard cover?                                                         | **Every path React Aria routes through `close()`: scrim, Escape, the header X, and every footer button wired to the render-prop `close`.** | They are one code path; separating them would need a new per-button API for a press whose label the user may still have mistaken. The two footer buttons that commit work before closing are handled by name (Steps 3.1, 3.2) rather than by exception. **This is the assumption most likely to be overridden - excluding _Cancel_ is one condition.**                              |
| Q4  | Do all eleven `isDismissable={false}` call sites adopt the guard?                               | **Ten do.** `confirm-delete-dialog.tsx` keeps its flag.                                                                                    | It has no form to be dirty (`<DialogBody />` is empty at `confirm-delete-dialog.tsx:59`); whether a destructive confirmation should close on a scrim press is a separate product decision and is not re-opened here.                                                                                                                                                                |
| Q5  | Does the guard extend to route navigation and tab close?                                        | **No. Deferred.**                                                                                                                          | A different mechanism (the router's blocker, `beforeunload`) with a browser dialog that cannot be localised or styled. Out of the request's scope and separable.                                                                                                                                                                                                                    |
| Q6  | Where does the alert live, given `components/ui` carries no copy?                               | **Mechanism in `components/ui/dialog.tsx`; copy and composition in `src/components/app/shell/form-modal.tsx`.**                            | `DialogHeader`'s `closeLabel` prop with its _"Localised by the caller"_ comment (`dialog.tsx:131-132`) is the existing precedent for exactly this boundary.                                                                                                                                                                                                                         |

No assumption here weakens security, tenant scoping, a `BACKWARD_COMPATIBILITY.md` surface or an
accessibility claim, so none carries `⚠ NEEDS HUMAN CONFIRMATION`.

## 📋 Phasing

- **Phase 1 - The panel stops growing.** Layout only, its own pull request. Fixes the clipped header on
  every dialog in the product and leaves `isDismissable={false}` exactly where it is.
- **Phase 2 - A refusable close, and one dialog that uses it.** `canClose`, `FormModal`, `useIsDirty`,
  the four copy keys, and the accounts form dialog as the first adopter. Nine dialogs still carry the
  old flag and behave as they do today.
- **Phase 3 - Adoption.** The remaining nine call sites, the filter drawer's conversion to controlled
  state, and the browser-level verification. Phases 2 and 3 are one pull request.
- **Deferred, not in this spec.** (a) A navigation guard (`beforeunload` + the router's blocker) for
  work abandoned by leaving the route rather than by closing the dialog (Q5). (b) Extending the
  2.4.11 / 2.4.12 probe in `.github/a11y/axe-scan.mjs` to open dialogs, so the failure in Problem 3
  has a standing verifier and not only the e2e case in Step 1.1.

## 📋 Implementation Plan

### Phase 1 - The panel stops growing (pull request 1)

**Step 1.1 - Write the failing browser case first.** New `e2e/modal-viewport.spec.ts`, at 1280 × 720
and 360 × 640, for the accounts form dialog and the recurring series dialog: the panel's bounding box
is inside the viewport; the `Heading slot="title"` and the submit button are both visible without
scrolling; `DialogBody` is the element with `scrollHeight > clientHeight`. Add a regression case per
docked placement - the transactions filter drawer (`drawer-end`) and the bottom-nav _More_ sheet
(`drawer`) - asserting the same three properties, because Step 1.2 edits the cva base they share.
_Verify:_ `pnpm e2e e2e/modal-viewport.spec.ts` fails on the centred dialogs and passes on the docked
ones, and the recorded numbers replace the static-reproduction figures in Problem 1.

**Step 1.2 - Bound the centred panel, and make the panel a column.** In
`src/components/ui/dialog.tsx`: add `flex flex-col` to the `modalVariants` base; `placement: 'center'`
becomes `'rounded-xl max-h-[calc(100dvh-2rem)] my-auto'`; the scrim's non-docked branch
(`dialog.tsx:99`) drops `items-center` and keeps `justify-center overflow-y-auto`. `Dialog`
(`dialog.tsx:123`) becomes `'flex min-h-0 flex-1 flex-col outline-hidden'`; `DialogHeader` and
`DialogFooter` each gain `shrink-0`; `DialogBody` is not edited. _Verify:_ `pnpm e2e
e2e/modal-viewport.spec.ts` green on all four dialogs, with no console error (skill
`verifying-changes`); `pnpm typecheck`, `pnpm lint`, `pnpm test` green.

### Phase 2 - A refusable close, and one dialog that uses it (pull request 2)

**Step 2.1 - `canClose` on `Modal`.** Optional; wraps `onOpenChange` as in Architecture. Its doc
comment states the controlled-only constraint. _Verify:_ new cases in
`src/components/ui/__tests__/dialog.test.tsx` - a `canClose` returning `false` leaves a controlled
dialog open after a scrim press, after Escape and after the header X; returning `true` closes on all
three; a `Modal` passing neither prop behaves exactly as before.

**Step 2.2 - `FormModal`, `useIsDirty` and the copy.** New
`src/components/app/shell/form-modal.tsx`: `FormModal` takes `isDirty`, holds `isAsking`, supplies
`canClose = () => isDirty ? (setAsking(true), false) : true`, and renders the nested `alertdialog`.
`useIsDirty(draft)` snapshots on first render and compares per key with `Object.is`, with the value
contract in its doc comment. Four `dialog.unsaved.*` keys in `en.ts` and `pl.ts` in the same commit.
_Verify:_ new `src/components/app/shell/__tests__/form-modal.test.tsx` - a `FormModal` with
`isDirty={false}` closes on a scrim press, on Escape and on the X; with `isDirty={true}` each of the
three opens the alert and leaves the dialog open with its values intact; _Discard changes_ calls
`onOpenChange(false)`; _Keep editing_ closes only the alert and restores focus; `useIsDirty` reports
false for an unchanged draft, true after a change, and **false again after a change is reverted**.
Plus `src/lib/i18n/__tests__/parity.test.ts` green.

**Step 2.3 - The first adopter.** `src/routes/_app/accounts/-ui/account-form-dialog.tsx` swaps `Modal`
for `FormModal`, drops `isDismissable={false}` (`:204`) and the comment that carried it, and passes
`isDirty={useIsDirty(draft)}`. _Verify:_ new `e2e/modal-unsaved.spec.ts` on the real route - open,
press the scrim, the dialog closes; reopen, type a name, press the scrim, the alert appears and the
name is still there; _Keep editing_; **change the currency through the `Select` only** and press
Escape - the alert must appear, which is the case the rejected alternative would have failed;
_Discard changes_, the dialog closes and the account list is unchanged.

### Phase 3 - Adoption (same pull request as phase 2)

**Step 3.1 - The eight remaining form dialogs.** `Modal` → `FormModal`, `isDismissable={false}`
removed, `isDirty` supplied: `budget-`, `category-`, `goal-`, `payee-` and `series-form-dialog` via
`useIsDirty(draft)`; `contribution-dialog` and `refund-dialog` from their own `useState` fields;
`adjust-balance-dialog` as **`result === null && (targetMinor !== null || note !== '')`** so that the
_Done_ button shown after a successful, already-written balance adjustment (`:239-257`) does not offer
a completed money write for discard. _Verify:_ an e2e case for `adjust-balance-dialog` that submits an
adjustment and presses _Done_, asserting no alert appears and the adjustment stands; `pnpm test`;
`pnpm e2e`.

**Step 3.2 - The filter drawer becomes controlled, and its committing buttons stop asking.**
`src/components/app/transactions/filter-bar.tsx` holds the open state that `DialogTrigger` holds
today and passes `isOpen`/`onOpenChange` to `FormModal`, so `canClose` can hold. _Apply_ and
_Reset filters_ (`:603-620`) call that `onOpenChange(false)` instead of the render-prop `close()`,
because by then `onViewChange` has committed the work. Its own commit, per the rollback note.
_Verify:_ e2e - open the drawer, change one filter, press the scrim, the alert appears;
_Discard changes_ leaves the filters as they were before the drawer opened; reopen, change a filter,
press _Apply_, **no alert**, the drawer closes and the new filter is applied.

**Step 3.3 - The gate and the evidence.** `grep -rl 'isDismissable={false}' src/` returns exactly two
files - `confirm-delete-dialog.tsx` (Q4) and `form-modal.tsx` (the alert's own overlay). Full
validation gate in `AGENTS.md` order. Capture the _Visual change expected_ table's frames with
`scripts/visual/capture.mjs` in light and dark at 360 and 1280, into `.ai/qa/artifacts_*/` and never
into the repository. _Verify:_ every command in `validation.commands` green, `pnpm e2e` green, frames
attached to the implementation PR.
