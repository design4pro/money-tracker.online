# Desktop layout density: every surface either earns its width or stops growing

## 📝 TLDR

Six of seven `_app` surfaces render at 1440px as a phone list handed a thousand pixels of empty rule;
the seventh, `/dashboard`, was already fixed at its header and is left with a lesser fault. This spec
gives the repository a named width band between the shell column and the reading measure, and then
makes a **per-surface decision**, recorded and defended here, between capping the measure and earning
the width. No data reaches any screen, no server module is touched, no migration runs. The deliverable
is a decision rule plus six phases, each independently shippable and each with an assertion a browser
can check at 1440×900.

## 📝 Problem Statement

`docs/rounds/2026-09-03-blind-comparison.md` §"The five findings that repeat across surfaces",
finding 1, is the evidence: seven critics with no contact between them, holding eight PNGs and
nothing else, converged on the same fault on six of the seven photographed surfaces. Issue #18
carries the per-surface measurements at 1440×900. The diagnosis in both documents is the same, and
it is not "add more content":

> A row that carries four short facts does not become a desktop layout by being given 1150px; it
> becomes a mobile row with a void attached. Either the row earns the width with columns, or the
> container stops growing.

**The shell is not the cause.** `src/styles/tokens.css:656` declares `--content-max: 80rem` (1280px);
`src/styles/app.css:163` re-exposes it as `--container-content` so it is reachable as
`max-w-content`; `src/components/app/shell/app-shell.tsx:93` applies it to `<main>` with
`px-4 sm:px-6 lg:px-8`. From `lg` up the rail is `w-55` and the content wrapper carries a matching
`lg:ps-55` (`app-shell.tsx:61,86`); with `--spacing: 0.25rem` (`tokens.css:555`) that is 220px. So a
1440px viewport gives `<main>` 1220px — under the 1280px cap, so the cap is not even the binding
constraint — and `lg:px-8` leaves **1156px of usable content width**. Every measurement in issue #18
was taken inside it.

What is missing is one level down. The repository names the outer column (`--content-max`) and names
running text (`--measure`, applied by `prose-measure` at `src/styles/app.css:507`), and has **nothing
between them**. A screen whose content is one column of list rows has no way to say "stop here", so
it inherits the full column and spans it, and each route improvises: `grep -rho "max-w-[a-z0-9]*"
src/routes/_app/ | sort -u` returns `max-w-2xl`, `max-w-3xl`, `max-w-5xl`, `max-w-md`, `max-w-prose`,
`max-w-sm`, `max-w-xs` — seven unnamed answers to one question, none applied to any surface in this
issue. `docs/SPEC.md` §8 calls that shape by its name: the concept has no owner.

Three consequences, each independently a defect:

1. **The void.** Recurring, budgets and categories rows end their content between x≈455 and x≈540 and
   draw a `border-subtle` rule to x≈1360 (issue #18, "Current"). The rule is a promise of a column
   that is not there.
2. **A false claim in the design document.** `DESIGN.md` → Layout → Reading measure states "every cap
   sits under the 80-character ceiling of WCAG 1.4.8, and no running text is uncapped". Eight `_app`
   page subtitles are drawn by a bare `<p className="mt-1 text-body text-ink-2">` with no cap at all,
   and four of them already break that ceiling in at least one locale — `rules.subtitle` at 147 `en`
   / 162 `pl`, `groups.subtitle` at 134 / 166, `categories.subtitle` at 89 / 81, `payees.subtitle` at
   80 / 84 (measured over `src/lib/i18n/messages/en.ts` and `pl.ts`). Polish is the longer locale for
   most of this copy, and `payees` is the one only Polish breaks. 1.4.8 Visual Presentation is one of
   the five AAA criteria `docs/SPEC.md` §10 says are "verified rather than aspired to".
3. **A wasted strength.** The same round records the budget object as a win — remaining amount as the
   largest type in the row, over-budget encoded four ways. It wins inside a row that is two thirds
   empty. The object is right and its container is wrong.

Filed separately and not re-litigated here: narrow-viewport truncation (#17), dark-theme separation
(#19), secondary-grey contrast (#20), missing empty/loading/error states (#21).

## 📝 Proposed Solution

**1. Name the middle band, once.** Add `--list-max` to `src/styles/tokens.css` beside `--content-max`
and re-expose it through the container namespace in `src/styles/app.css` exactly as `--content-max`
already is, so it is reachable as `max-w-list`. One token, one utility name, no new component and no
new file under `src/components/ui` — the existing `--content-max` → `--container-content` →
`max-w-content` chain is the precedent and this follows it verbatim, name shape included.
`src/styles/__tests__/token-classes.test.ts` already guards that chain against a silent rename (its
comment at line 83 says why), and it guards the new band by the same mechanism the moment a source
file uses it — the file holds one generic case that scans `src/**/*.{ts,tsx}` for token-shaped
classes and asserts each one resolves, so there is no per-class case to add and none is added. Its
own docblock records the consequence this spec has to live with: a token nothing consumes yet is not
checked, so the guard first bites on `max-w-list` in Phase 2, not in Phase 1.

Value: **56rem (896px)**. Derivation, not taste: the band must be wide enough that a capped row does
not start truncating its own content — that is #17's fault and this spec must not manufacture it —
and narrow enough that the tail is under issue #18's pass condition of "roughly a third". 896px
against the 1156px measured above leaves a 260px tail, 22%. It is a token with a test beside it, so
tuning it later is one line.

**Start-aligned, never centred.** A capped block takes `max-w-list` and nothing else, inheriting the
shell's start edge. Centring inside the already-centred column would break the shared start edge
between a page's `<h1>` and its list and trade one void for two half-voids. Issue #18 permits either;
this spec picks start-alignment, and the freed tail does nothing — which is the issue's stated
preference over "being spanned by a rule".

**2. Decide per surface, and defend each decision.** Issue #18 asks for exactly this: "Decide per
surface which one applies and say so in the PR; a blanket `max-width` would be as thoughtless as the
current blanket stretch." **This decision rule, not the token, is what makes the seven surfaces one
piece of work** — the token is consumed by three of the six phases and the rule governs all six:

> A **rule-separated list row** whose content is a name and a handful of short facts **caps**.
> A **card** whose interior is a single row of facts **pairs** into a two-column grid — two columns
> are columns, and they justify the spread without inventing content.
> A **band of chrome** (a filter, a toolbar, a page header) **earns** its width by carrying something
> at both ends, or it stops spanning.

| Surface                | Decision               | The move                                                                                                           | Why this one                                                                                                                                                                              |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/categories`          | **cap**                | The tree caps at `max-w-list`.                                                                                     | A name, a swatch, a badge and an overflow menu. There is no fifth fact to promote to a column; the ~900px between badge and menu is nothing.                                              |
| `/transactions/groups` | **cap**                | The table container caps at `max-w-list`.                                                                          | The table already carries four column headers. Its defect is a four-column table stretched over 1156px, not missing columns.                                                              |
| `/budgets`             | **pair**               | The budget list becomes a two-column grid from `lg`.                                                               | Halves the row to ~570px and closes the ~1000px empty rule **without touching the budget object**, which this round records as a strength.                                                |
| `/recurring`           | **earn** — two panes   | At `lg` a `[minmax(0,1fr)_20rem]` grid: series list in the first pane, `Due soon` as a rail in the second.         | Fixes both of the surface's measurements at once: the series row loses width it was not using, and `Due soon` stops spreading one row over ~1130px.                                       |
| `/dashboard`           | **earn** — already met | Nothing on the header band; it passes as it stands. The widget grid stops equalising row heights.                  | The header defect #18 measured was closed by the passbook work after the issue was filed (see below); what is left is the 120–150px card voids, which are stretch-to-tallest, not design. |
| `/accounts`            | **earn** — toolbar     | The `Show` filter keeps the start of its band; the end carries a count of what the filter is currently showing.    | The account grid already fills the canvas. The single measured defect is a lone control on a 1156px band.                                                                                 |
| `/transactions`        | **earn** — toolbar     | The search field stops being `flex-1` and caps; the three icon controls close up beside it into one start cluster. | `src/components/app/transactions/filter-bar.tsx:344` gives the field `flex-1`, which is precisely what pushes the three icons to the far edge.                                            |

**One of issue #18's measurements has already expired.** #18 was filed on 2026-09-03 and records
`/dashboard` as "an empty ~1000px header strip with no primary action". That is no longer HEAD: the
passbook work landed on 2026-09-07 (`cf483b7`, `11e8848`) and rewrote
`src/components/app/dashboard/dashboard-header.tsx`, which now renders a `justify-between` band with
the `<h1>` and its period caption at the start and, at the end, the `PeriodSelector` passed as
`action` from `src/routes/_app/dashboard/index.tsx:92` beside the primary "New transaction" link
(`dashboard-header.tsx:103-125`). Measured against this spec's own "earn" criterion — a rendered node
within 32px of each end — the band already passes, at every width. The spec therefore claims no
header work: the only `/dashboard` defect from #18 still open, besides the Net worth void deferred in
Q10, is the widget grid's stretch-to-tallest, and Phase 5 is scoped to that alone.

The eight page subtitles are **not** in this table. Capping running text is one class on one element,
`DESIGN.md` already claims it product-wide, and splitting it across five surface phases would leave
the claim false in between; Phase 1 owns all eight at once — `/categories` included, which is why the
count is eight and not the seven of the surfaces above.

**Alternatives considered and rejected.**

- _A blanket `max-w-list` on the shell's `<main>`._ One line, and wrong: it would cap the dashboard
  grid, the accounts grid and the transaction ledger, all of which genuinely use the full column.
  Issue #18 names this ("as thoughtless as the current blanket stretch").
- _Turn budget and recurring rows into real `<Table>` columns._ It satisfies the letter of "earn the
  width with columns" and costs the two things the round praised: the budget object's
  largest-type-is-remaining hierarchy and its four-channel over-budget encoding, neither of which
  survives a table cell. Rejected on evidence.
- _A `<Well>` layout component under `src/components/ui`._ `docs/SPEC.md` §8 asks for one primitive
  per interaction pattern; a width band is not an interaction pattern, and `prose-measure` proves the
  utility route works. A component would add a file, an export and a test for a `max-width`.
- _Widen `--content-max` past 80rem._ Moves the problem outward and makes every void larger.

**What the open-source field does.** The comparison is against open-source products only
(`docs/agents/reference.md`, and the repo-local `om-spec-writing` clean-room clause): the pattern
worth taking is that a ledger-shaped app gives its **list** a bounded measure and spends the freed
canvas on a **second pane** rather than on a wider row — which is what Phase 3 does for `/recurring`.
The pattern worth skipping is the density toggle: a per-user "comfortable / compact" setting is a
stored preference, a settings row, a migration and two layouts to maintain, and it exists to let a
user work around a layout that was never decided. Deciding per surface is cheaper and it is what
issue #18 asked for.

## 📝 Architecture

Owner modules, per `docs/SPEC.md` §8 — one concept, one owner:

| Concept                                      | Owner                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| The width vocabulary (all three bands)       | `src/styles/tokens.css`, exposed by `src/styles/app.css`                         |
| The guard that the vocabulary still resolves | `src/styles/__tests__/token-classes.test.ts`                                     |
| The prose written about it                   | `DESIGN.md` → Layout                                                             |
| Per-surface application                      | the route module or the `src/components/app/<area>/` component owning that block |

Every change is presentational and lives in a route module, an `app/` component or the style layer,
so the layering contract of `docs/SPEC.md` §6.1 holds trivially and `components/ui` is neither
touched nor made to fetch anything.

### The band, concretely

```css
/* src/styles/tokens.css — beside --content-max */
--list-max: 56rem; /* 896px — a single column of list rows */

/* src/styles/app.css — beside --container-content */
--container-list: var(--list-max);
```

The three bands are then a complete vocabulary, and `DESIGN.md` states which is for what:

- `--measure` (64ch, via `prose-measure`) — running text of more than one paragraph; it also sets the
  reading leading and the paragraph gap, so it is not a width utility and is not used as one.
- `--list-max` (56rem, via `max-w-list`) — a single column of list rows.
- `--content-max` (80rem, via `max-w-content`) — the shell column, and anything that earns it.

A one-line page subtitle wants a width cap and nothing else, so it takes `max-w-prose` (65ch, width
only). Changing its leading would move it off the 2.5rem pitch that `DESIGN.md` → The On-Pitch Rule
governs, which is why `prose-measure` is the wrong tool there.

## 📝 Data Model and API Contracts

No change to either. No table, column, index or migration; `drizzle/` is not regenerated. No server
function is added or re-shaped, so the "Zod twice" rule (`docs/SPEC.md` §5.1, §6.1) has no new
surface. No amount is read, written, converted or re-scaled, so `docs/MONEY.md` is untouched.
`BACKWARD_COMPATIBILITY.md` protects no CSS custom property or utility name, and this spec removes
none regardless: `--list-max` is purely additive.

## 📝 UI/UX

Only what is unique to this change.

**Reflow.** Every capped block uses `max-width`, never a fixed `width`, so below 896px the cap is
inert and today's layout renders unchanged. The two-pane and two-column grids are `lg:`-prefixed and
collapse to today's single column below 1024px. **Phases 1, 2, 4 and 5 therefore change nothing below
1024px, and each asserts it.** Two phases do change narrow viewports, each for its own reason, and
both say so in their steps rather than hiding behind a blanket guarantee: **Phase 3 reorders**
`/recurring` at every width, and **Phase 6 adds a node** to the `/accounts` band. See Risks for why
the distinction matters to #17 — a reorder costs no height, an added node does.

**Reading order equals visual order, and that has a price on narrow.** The `/recurring` two-pane
split is the one change that could break 1.3.2, and the honest consequence is a narrow-viewport
change this spec does not get to avoid. At HEAD `UpcomingPanel` — the `Due soon` block — renders
_before_ the series list in a single-column stack (`src/routes/_app/recurring/index.tsx:171`), so
moving it after the list to feed the second grid column reorders what a phone shows: `Due soon` ends
up below the series list at every width under `lg`. The alternative — leaving it first in the DOM and
placing it in the second column with `order` or an explicit `grid-row`/`grid-column` — is exactly
what `src/components/app/dashboard/widget-grid.tsx` forbids in its header comment, and it is a 1.3.2
failure that only shows up on a phone. So the reorder is accepted, stated in the visual-change table,
and asserted at 360px rather than assumed away.

**Focus and targets.** Closing the gap between the `/transactions` search field and the three icon
controls changes their x positions, not their target boxes; every control keeps the 44×44 area
`docs/SPEC.md` §2.2 and AAA 2.5.5 require. `DESIGN.md` → The Focus Reserve Rule still applies to a
capped container: a cap must not become a crop of a focus ring.

**Empty and loading states follow their container.** A skeleton that spans while its content does not
is a layout shift after paint, which `docs/SPEC.md` §2.10 forbids. `recurring-skeletons.tsx`,
`budget-skeletons.tsx`, `account-skeletons.tsx` and the `groups.tsx` skeleton at line 88 are in scope
for their phase.

**Cards are not becoming the scaffold.** `DESIGN.md` → Don't forbids "cards as the scaffold of a page,
or a grid of equal icon cards as a section", and the Rules-Not-Cards Rule allows a card as "a slip
laid on the paper for content that genuinely needs its own ground (a chart, a form)". `/budgets` is
already a list of `BudgetCard`s at HEAD and each carries a meter; Phase 4 changes their arrangement,
not the page's scaffold, and introduces no icon card. If a reviewer reads the Rule the other way, the
fallback is one line — the single column caps at `max-w-list` like `/categories` — and Phase 4 says
so in its steps rather than leaving the reviewer to invent it.

## 📝 Visual change expected

Both themes, both locales, every route below.

| Route                                      | State captured                                 | 1440×900                  | 360×800                                              |
| ------------------------------------------ | ---------------------------------------------- | ------------------------- | ---------------------------------------------------- |
| `/categories`                              | populated tree, one branch expanded            | changes                   | unchanged                                            |
| `/transactions/groups`                     | populated (≥2 groups) and empty                | changes                   | unchanged                                            |
| `/budgets`                                 | ≥3 budgets, one over budget; and exactly 1     | changes                   | unchanged                                            |
| `/recurring`                               | ≥1 overdue and ≥1 due-soon row; and none due   | changes                   | **changes** — `Due soon` moves below the series list |
| `/dashboard`                               | populated, default period                      | changes                   | unchanged                                            |
| `/accounts`                                | populated, `Show = Open accounts` and narrowed | changes                   | **changes** — band gains a count                     |
| `/transactions`                            | populated ledger, no filter and ≥1 filter chip | changes                   | unchanged                                            |
| `/payees`, `/goals`, `/transactions/rules` | populated                                      | subtitle line length only | unchanged                                            |

Frames are recorded with `scripts/visual/capture.mjs`, read by a human as evidence, and attached to
the PR. They are never a comparator gate — ADR 0016 removed that and this spec does not reinstate it
— and no PNG enters the repository; artefacts live under `.ai/qa/artifacts_*/`.

## 📝 Copy

One new user-facing string. It lands in **both** catalogues in the same change per `docs/SPEC.md` §9
and the `i18n-messages` skill, and it uses the plural machinery — an `if (n === 1)` would be a defect,
and Polish needs four CLDR categories.

| Key                     | `en`                                  | Notes                                                                                                                                                                           |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts.filter.count` | `Showing {shown} of {total} accounts` | The `/accounts` toolbar counterweight. Plural on `{total}`. Both numbers are formatted by the message formatter with the active locale, never concatenated (`docs/SPEC.md` §9). |

No other key is added, renamed or removed. In particular `/dashboard` needs none: its header already
renders `transactions.create` ("New transaction") at HEAD, and this spec adds nothing to that band.

## 📝 Edge Cases & Failure Scenarios

- **A long name in a capped container.** Capping narrows the row, which is the pressure #17 is about.
  Each capping step asserts the surface's longest seeded name still renders in full at 1440px; a
  failure is #17's defect surfacing early and is filed there, never absorbed by widening the band.
- **`/recurring` with nothing due.** The rail must not become an empty 20rem column beside a full
  list, and must not appear and disappear between renders. It keeps its column and renders the
  existing `recurring.due.none` copy.
- **`/budgets` with exactly one budget.** A two-column grid with one child is the same fault at a
  smaller scale. One card renders at `max-w-list` instead of at half the grid.
- **`/accounts` with the filter showing everything.** `Showing 12 of 12 accounts` is noise; the count
  renders only when the filter is actually narrowing the list.
- **A longer Polish string in a capped block.** `pl` is the longer locale for most of this copy, so
  every capped block is asserted in both locales — a band tuned on English and broken in Polish is a
  failure this repository has recorded once already.

## 📝 Risks & Impact Review

**Blast radius.** Presentational and wide: seven `_app` routes, eight page subtitles, no server
module, no shared `components/ui` primitive. The one genuinely shared change is the token, and it is
additive — no existing token is renamed, so nothing that resolves today can stop resolving.

**Compatibility.** No ADR is contradicted and none is needed: this applies `DESIGN.md`'s existing
Layout section rather than deciding something new. `DESIGN.md` gains the third band in Phase 1, in
the same PR as the token, so the document and the code never disagree.

**Rollback**, stated per phase because the phases are not equally reversible:

- Phases 2, 3, 4, 5 revert cleanly on their own: each is one PR touching one product area's layout,
  with no data and no stored state behind it.
- Phase 6 additionally requires removing `accounts.filter.count` from **both** `en.ts` and `pl.ts`; a
  revert that drops one catalogue turns the parity test red.
- Phase 1 is **not** independently revertible once Phase 2 or 4 has merged — those consume
  `max-w-list`, and reverting the token would leave a dangling class that silently resolves to
  nothing. Phase 1 reverts only after, or together with, its consumers. The `DESIGN.md` amendment and
  the subtitle caps within Phase 1 revert independently of the token.

**The real risk is taste, not correctness.** 56rem is a judgement. It is mitigated by being one token
with a test beside it, by the per-surface assertion that the tail is under a third, and by frames read
by a human in both themes before each phase merges. A band that turns out wrong costs one line.

**The second risk is collision with #17.** Both issues touch the same rows. Phases 1, 2, 4 and 5
change nothing below 1024px and assert it, so they cannot collide. Two phases do reach the phone, and
the risk is not the same in each:

- **Phase 6** adds a node to the `/accounts` band at every width, which is height a phone does not
  have to spare. `src/routes/_app/accounts/index.tsx` already records what happens when a header row
  grows there ("that row plus the overview card was enough to push every single account below the
  fold"), so the phase carries an explicit above-the-fold assertion at 360×800 in both locales and
  must not repeat that mistake.
- **Phase 3** reorders `/recurring` rather than growing it: `Due soon` moves below the series list,
  the node count and the stack height are unchanged, and nothing moves below the fold that was not
  already there. The narrow-viewport risk is a **content** one, not a density one — a user who opens
  `/recurring` on a phone to see what is due now scrolls past the series list to find it — and it is
  the price of keeping reading order equal to visual order at `lg`. Phase 3 asserts the new order at
  360px and flags it for the human reading the frames, who may still overrule the trade.

**Deliberately not in this spec.** The Net worth widget's ~140px mid-card void that issue #18 also
measures is **vertical** density inside one chart card, it would mean touching a hand-rolled chart
(ADR 0007) and its visually-hidden data table, and it shares neither the decision rule nor the token
with anything here. Phase 5 files it as a follow-up issue rather than smuggling it in.

## 📝 Resolved assumptions (autonomous defaults)

This spec was written by an unattended run. Every question below was resolved toward the smallest
reversible change, and every one is a decision a human may overturn before this PR merges. None
carries `⚠ NEEDS HUMAN CONFIRMATION`: no answer weakens security, tenant scoping, a
`BACKWARD_COMPATIBILITY.md` surface or an active ADR, and each is a one-line reversal.

| #   | Question                                                                                       | Resolved as                                      | Rationale                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | One named width band in the token layer, or a per-surface `max-w-*` at each call site?         | One band, `--list-max`, exposed as `max-w-list`. | `docs/SPEC.md` §8: the concept has no owner today and seven unnamed answers are already in `src/routes/_app`. Additive; nothing existing is renamed.                                                                                                                                            |
| Q2  | What value?                                                                                    | `56rem` (896px).                                 | Leaves a 260px tail in the measured 1156px column — 22%, under issue #18's "roughly a third" — while giving a series row more width than it uses today. It is a token with a test.                                                                                                              |
| Q3  | Capped blocks centred in the canvas, or start-aligned?                                         | Start-aligned.                                   | Keeps the shared start edge with the page `<h1>`; centring trades one void for two. Issue #18 permits either.                                                                                                                                                                                   |
| Q4  | Does `/transactions/groups` get the "earn" treatment issue #18 floats for it?                  | No — it caps.                                    | "Earn" there means a summary or a counterweight, which is content, and issue #18's own Out of scope forbids adding data to a screen. Its four column headers already exist.                                                                                                                     |
| Q5  | Is a "showing N of M" count on `/accounts` new data?                                           | No — it ships.                                   | It counts rows already rendered on the same screen: a layout counterweight, not a new figure. Reversible: one string and one node.                                                                                                                                                              |
| Q6  | Cap all eight uncapped `_app` page subtitles, or only the four on surfaces #18 names?          | All eight, in Phase 1.                           | `DESIGN.md` already claims "no running text is uncapped" product-wide; capping any subset leaves the design document false. Eight, not seven: `/categories` has the same bare `<p>` (`src/routes/_app/categories/index.tsx:152-154`) and its `en` string is 89 characters. One class per `<p>`. |
| Q7  | Convert budget and recurring rows into real `<Table>` columns — the literal reading of "earn"? | No — pair the cards, split the panes.            | The round records the budget object as a strength; its type hierarchy and four-channel over-budget encoding do not survive a table cell. Two cards on a row are two columns.                                                                                                                    |
| Q8  | One spec, or split the vocabulary from the surfaces?                                           | One spec, six phases.                            | What unifies them is the cap-or-earn decision rule, which governs all six; the token is consumed by three. Splitting would leave the rule stated in one document and applied in another.                                                                                                        |
| Q9  | Should any phase also address the truncation that capping may expose?                          | No — it is #17.                                  | Each capping step asserts the longest seeded name still renders; a failure is reported to #17 rather than absorbed by widening the band.                                                                                                                                                        |
| Q10 | Does the Net worth widget's mid-card void belong here?                                         | No — Phase 5 files it as a follow-up.            | Vertical density inside a hand-rolled chart (ADR 0007); shares neither the decision rule nor the token.                                                                                                                                                                                         |
| Q11 | Does this need an ADR?                                                                         | No.                                              | It applies `DESIGN.md`'s existing Layout section; the amendment lands in `DESIGN.md` in Phase 1, in the same PR as the token.                                                                                                                                                                   |

## 📋 Phasing

Six phases. Each is one product area, no migration, finishable in one `om-auto-create-pr` run
(`docs/SPEC.md` §8 and the repo-local `om-spec-writing` phasing rule).

**No phase touches `src/server/repos`, so no step owes a case in
`src/server/repos/__tests__/tenant-isolation.test.ts`; no phase touches an amount, so no step owes a
case in `src/server/repos/__tests__/money-invariants.test.ts`.** Stated once, here, for all six.

- **Phase 1 — The width vocabulary.** The token, the utility, the `DESIGN.md` amendment and the eight
  subtitle caps. Ships alone; **gates Phases 2 and 4**, which consume `max-w-list`.
- **Phase 2 — The two caps.** `/categories` and `/transactions/groups`. Needs Phase 1, and is where
  the token guard first bites.
- **Phase 3 — `/recurring`.** The two-pane split. Independent of Phase 1. The one phase that reorders
  a narrow viewport.
- **Phase 4 — `/budgets`.** The two-column grid. Needs Phase 1 for its single-budget case.
- **Phase 5 — `/dashboard`.** The widget-grid stretch only — the header band already passes.
  Independent of Phase 1, and the smallest phase here.
- **Phase 6 — The two toolbars.** `/accounts` and `/transactions`. Independent of Phase 1.

## 📋 Implementation Plan

Every step leaves the application working and is verifiable by a test. The acceptance criterion is
issue #18's pass condition, expressed per decision type so a browser can check it at 1440×900:

- **cap** — the named block's `getBoundingClientRect().width` is ≤ 912px (the band plus a 16px
  tolerance).
- **pair** — two cards sit on one row: equal `y`, differing `x`, each ≤ 620px.
- **earn** — the named band carries a rendered node within 32px of each of its two ends.

A Playwright assertion is cheaper and more honest than a photograph, and ADR 0016 removed the
photograph gate for exactly this reason; frames are still captured and read, as evidence.

### Phase 1 — The width vocabulary

New message keys: none.

1. Add `--list-max: 56rem` to `src/styles/tokens.css` beside `--content-max`, with the comment shape
   the existing entry uses and its px equivalent.
   _Verify:_ `pnpm typecheck`, `pnpm lint`, `pnpm build`.
2. Expose it as `--container-list: var(--list-max)` in `src/styles/app.css` beside
   `--container-content`, so it is reachable as `max-w-list`.
   _Verify:_ **no new test case, and no red-then-green here.**
   `src/styles/__tests__/token-classes.test.ts` holds one generic case that scans
   `src/**/*.{ts,tsx}` for token-shaped classes and asserts each resolves; it has no per-class case
   to copy, and its docblock states that a token with no consumer is not checked. Phase 1 adds no
   consumer, so that test is green before and after this step and proves nothing about it. What is
   verifiable now is that the exposure compiles and the utility exists: `pnpm build`, plus reading
   the generated CSS for the `--container-list` declaration. The guard becomes real in Phase 2, and
   that phase owns the red-green.
3. Amend `DESIGN.md` → Layout: the three bands, what each is for, the start-aligned rule, and the
   sentence that `prose-measure` is not a width utility.
   _Verify:_ `pnpm check` clean on the touched file; the section names all three tokens.
4. Cap all eight page subtitles with `max-w-prose` — `categories`, `groups`, `accounts`, `budgets`,
   `recurring`, `payees`, `goals`, `rules` — and nothing else on those elements.
   _Verify:_ a browser case asserting each subtitle's rendered width is ≤ 65ch at 1440px in both
   locales, and that its computed `line-height` is unchanged from HEAD. The four that break the
   ceiling today (`rules`, `groups`, `categories`, `payees` — the last only in `pl`) are the cases
   that must visibly wrap after this step.
5. Capture 1440 and 360 frames, light and dark, both locales, for the three routes that have no
   later phase (`/payees`, `/goals`, `/transactions/rules`); read them.

### Phase 2 — `/categories` and `/transactions/groups` (cap)

New message keys: none. Screens whose rendered output changes: `/categories`,
`/transactions/groups`.

1. Cap the category tree at `max-w-list` in `src/routes/_app/categories/index.tsx`, start-aligned,
   including its skeleton and its empty and error states.
   _Verify:_ tree container ≤ 912px at 1440×900; byte-identical layout at 360×800; the longest seeded
   category name renders in full. **This is where Phase 1's token guard first bites**, because
   `max-w-list` now appears in a `.tsx` file and the scanner in
   `src/styles/__tests__/token-classes.test.ts` therefore picks it up: confirm the red-green Phase 1
   could not show by deleting `--container-list` from `src/styles/app.css` and re-running
   `pnpm test src/styles/__tests__/token-classes.test.ts` — it must fail with `max-w-list` in `dead`
   — then restore it and watch it pass.
2. Cap the groups `TableContainer` at `max-w-list` in `src/routes/_app/transactions/groups.tsx`,
   including the skeleton at line 88 and the empty state.
   _Verify:_ table container ≤ 912px at 1440×900; the four column headers still render; unchanged at
   360×800.
3. Capture and read frames for both routes at 1440 and 360, light and dark, both locales.

### Phase 3 — `/recurring` (earn, two panes)

New message keys: none. Screens whose rendered output changes: `/recurring`, **at every width** — see
step 1.

1. Move the `Due soon` block (`UpcomingPanel`) in the DOM to follow the series list **and** wrap both
   in a `lg:grid-cols-[minmax(0,1fr)_20rem]` grid with `items-start`, in the same step. The two are
   not separable: at HEAD `UpcomingPanel` renders _before_ the series list in a single-column stack
   (`src/routes/_app/recurring/index.tsx:171`), so the DOM move on its own is a visible reorder at
   every width with no grid to justify it. Landing them together keeps every intermediate state of
   the branch coherent, and scopes the reorder to this phase where the visual-change table and the
   Risks section both record it.
   _Verify:_ `pnpm test` green; at 1440×900 the two panes sit on one row and the series pane is
   ≤ 912px; at 1023px and at 360px they stack in DOM order, with `Due soon` **below** the series list
   — the deliberate narrow-viewport change, asserted rather than assumed; a browser case asserting
   the accessibility-tree order matches the visual order at both widths, with no `order` and no
   explicit `grid-row`/`grid-column` anywhere in the diff.
2. Keep the rail present when nothing is due, rendering `recurring.due.none`.
   _Verify:_ a browser case on a seeded workspace with series but nothing outstanding — the grid still
   has two columns, and the rail's rendered width is identical to the populated case.
3. Follow the split through `recurring-skeletons.tsx` so loading has the same geometry.
   _Verify:_ the skeleton's and the loaded state's pane widths match to within 1px.
4. Capture and read frames at 1440 and 360, light and dark, both locales, and put the **360 pair —
   before and after — at the top of the PR body** with the reorder named in words: on a phone
   `Due soon` now sits below the series list. This is the phase's one contestable trade (Risks,
   collision with #17) and the PR must ask for it explicitly rather than let a reviewer discover it
   in a frame.

### Phase 4 — `/budgets` (pair)

New message keys: none. Screens whose rendered output changes: `/budgets`. Needs Phase 1.

1. Lay the budget list out as `grid gap-4 lg:grid-cols-2` with `items-start`, leaving `BudgetCard`
   itself untouched.
   _Verify:_ with ≥3 budgets, two cards share a row at 1440×900 (equal `y`, differing `x`) and each is
   ≤ 620px; one column at 1023px and below.
2. Render a single budget at `max-w-list` rather than at half the grid.
   _Verify:_ with exactly one seeded budget, card width ≤ 912px.
3. Follow the layout through `budget-skeletons.tsx` and the empty state.
   _Verify:_ a browser case on the loading and empty states.
4. Capture and read frames; confirm the over-budget row still carries all four encodings (icon, word,
   colour, hatch) at the narrower width. Record in the PR whether the reviewer accepts the
   Rules-Not-Cards reading in the UI/UX section; if not, apply the stated one-line fallback (single
   column at `max-w-list`) instead of redesigning the card.

### Phase 5 — `/dashboard` (the widget grid only)

New message keys: none. Screens whose rendered output changes: `/dashboard` at ≥`lg` only — the
widget grid is `grid-cols-1` below that, so `items-start` is inert on a phone.

**The header band is out of scope, deliberately.** Issue #18's "empty ~1000px header strip with no
primary action" was measured on 2026-09-03 against a dashboard header that no longer exists; the
passbook work (`cf483b7`, `11e8848`, 2026-09-07) replaced it with the `justify-between` band at
`src/components/app/dashboard/dashboard-header.tsx:103-125`, which carries the `<h1>` at the start and
the `PeriodSelector` plus the primary "New transaction" link at the end. It already satisfies this
spec's `earn` criterion at every width, so there is nothing to place, nothing to reuse
`transactions.create` for, and no narrow-viewport regression to guard against. A phase that "fixed"
it would be a diff with no defect behind it.

1. Stop the widget grid equalising row heights: `items-start` in
   `src/components/app/dashboard/widget-grid.tsx`, whose class list is
   `grid list-none grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3` at HEAD and therefore stretches
   every row item to the tallest.
   _Verify:_ with a seeded dashboard where two widgets on one row hold different amounts of content,
   their rendered heights differ at 1440×900; unchanged at 360×800, where the grid is one column; the
   existing widget-grid tests stay green.
2. Re-confirm the header band still passes before closing the phase, so the claim above does not rot
   silently.
   _Verify:_ a browser case asserting the header band carries a rendered node within 32px of each of
   its ends at 1440×900 — an assertion on existing behaviour, expected green on the first run, and the
   thing that will go red if a later change empties the band again.
3. File the Net worth widget's mid-card void as its own issue, quoting issue #18's measurement, and
   link it from the PR.
4. Capture and read frames at 1440 and 360, light and dark, both locales.

### Phase 6 — `/accounts` and `/transactions` toolbars (earn)

New message keys: `accounts.filter.count` (EN + PL). Screens whose rendered output changes:
`/accounts` **at every width**, `/transactions` at ≥`md`.

1. Add `accounts.filter.count` to `src/lib/i18n/messages/en.ts` and `pl.ts` in the same change, with
   the four Polish CLDR categories.
   _Verify:_ the i18n parity test is green; a unit case asserting the Polish plural resolves for 1, 2,
   5 and 22.
2. Lay the `/accounts` filter band out with the `SegmentedFilter` at its start and the count at its
   end, rendered only when the filter narrows the list.
   _Verify:_ at 1440×900 the band carries a node within 32px of its end when a filter is active and
   none when it is not; at 360×800 the first account row is still above the fold in both locales; the
   filter's 44×44 targets are unchanged.
3. Cap the `/transactions` search field in `src/components/app/transactions/filter-bar.tsx:344` —
   replace `flex-1` from `md` up with a bounded width — so the three icon controls close up beside it
   into one start cluster.
   _Verify:_ at 1440×900 the gap between the field's end edge and the first icon control is under
   16px; below `md` the field still fills its row; every control keeps 44×44.
4. Capture and read frames for both routes at 1440 and 360, light and dark, both locales.

---

## Amendment — what Phase 3 actually shipped (2026-09-10, PR #156)

Two of this document's numbers did not survive contact with the rendered page. They are corrected
here rather than left for a reader to discover from the diff, because the spec is what somebody
opens first.

**The `/recurring` rail is `30rem`, not `20rem`, and the panes start at `xl`, not `lg`.**

`Due soon` is a table. Measured at 1440x900, it needs 290px (`en`) / 298px (`pl`) for its three
ordinary columns and **419px** once a late period adds the status column — `PeriodStatusBadge` is
`whitespace-nowrap font-semibold` inside a border and reads `Po terminie`. A `20rem` track with
`Card padding="md"` leaves 278px, so the rail shipped scrolling sideways on a 1440px desktop before
any row was late. `30rem` leaves 438px, which holds the widest state in both locales.

A rail that wide cannot start at `lg`: the page column is 740px at 1024px of viewport, so the panes
there would be 230px for the series list against 480px for the aside — this document's own finding
1, reintroduced on the pane that matters. At 1280 the panes are 492/480 and at 1440 they are
652/480.

Below `xl` the panes stack, and a stacked pane left alone takes the whole 995px well, which is the
same fault again. So the container carries `max-w-list` below the breakpoint and drops it above,
where both tracks are already narrower than the band.

The decision rule this document sets out is unchanged — earn the width where there is width to
earn — and this is that rule applied to measurements the document did not have. Everything else in
Phase 3, including the DOM reorder and its WCAG 1.3.2 reasoning, shipped as written.

**Phase 6 step 3 shipped as an assertion and no edit.** Measured before it was written, the
`/transactions` search field is already 274px (`en`) / 282px (`pl`) inside a 1156px bar and every
control after it sits at the bar's own 8px gutter, so the `md:max-w-md` cap would not have bound at
any viewport. The reasoning is the one this document already applies to the dashboard header band.
