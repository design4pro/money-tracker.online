# Execution plan — desktop layout density (issue #18)

**Slug:** `issue-18-desktop-layout-density`
**Branch:** `feat/issue-18-desktop-layout-density`
**Base:** `develop`
**Source spec:** `.ai/specs/2026-09-09-desktop-layout-density.md` (landed by PR #134)
**Issue:** #18
**Engine:** `om-auto-create-pr-loop` (steps: 24, `--loop`: no) — routed on the spec's 24-step
Implementation Plan, which exceeds `engine.loopStepThreshold` (20).

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title                                                                    | Exec   | Status | Commit |
| ----- | ---- | ------------------------------------------------------------------------ | ------ | ------ | ------ |
| 1     | 1.1  | Add `--list-max: 56rem` to `tokens.css`                                  | inline | done   | b4a8975|
| 1     | 1.2  | Expose `--container-list` in `app.css`                                   | inline | todo   | —      |
| 1     | 1.3  | Amend `DESIGN.md` → Layout with the three width bands                    | inline | todo   | —      |
| 1     | 1.4  | Cap the eight `_app` page subtitles with `max-w-prose`                   | inline | todo   | —      |
| 2     | 2.1  | Cap the category tree at `max-w-list`                                    | inline | todo   | —      |
| 2     | 2.2  | Cap the groups table container at `max-w-list`                           | inline | todo   | —      |
| 3     | 3.1  | Split `/recurring` into two panes and move `Due soon` after the list     | inline | todo   | —      |
| 3     | 3.2  | Keep the rail's column when nothing is due                               | inline | todo   | —      |
| 3     | 3.3  | Follow the split through `recurring-skeletons.tsx`                       | inline | todo   | —      |
| 4     | 4.1  | Lay the budget list out as a two-column grid from `lg`                   | inline | todo   | —      |
| 4     | 4.2  | Render a single budget at `max-w-list`                                   | inline | todo   | —      |
| 4     | 4.3  | Follow the pairing through `budget-skeletons.tsx` and the filtered empty | inline | todo   | —      |
| 5     | 5.1  | Stop the dashboard widget grid equalising row heights                    | inline | todo   | —      |
| 5     | 5.2  | Assert the dashboard header band still carries both ends                 | inline | todo   | —      |
| 5     | 5.3  | File the Net worth mid-card void as a follow-up issue                    | inline | todo   | —      |
| 6     | 6.1  | Add `accounts.filter.count` to both catalogues                           | inline | todo   | —      |
| 6     | 6.2  | Give the `/accounts` filter band a counterweight at its end              | inline | todo   | —      |
| 6     | 6.3  | Cap the `/transactions` search field from `md` up                        | inline | todo   | —      |

## Goal

Give the repository a named width band between the shell column and the reading measure, then apply
the spec's per-surface decision — **cap the measure** or **earn the width** — to the seven `_app`
screens that render at 1440px as a phone list with a void attached (issue #18, finding 1 of
`docs/rounds/2026-09-03-blind-comparison.md`).

## Scope

- `src/styles/tokens.css`, `src/styles/app.css` — the token and its container-namespace exposure.
- `DESIGN.md` → Layout — the three-band vocabulary, so the document and the code agree.
- Eight `_app` page subtitles — `categories`, `groups`, `accounts`, `budgets`, `recurring`,
  `payees`, `goals`, `rules`.
- Seven surfaces: `/categories`, `/transactions/groups`, `/budgets`, `/recurring`, `/dashboard`
  (widget grid only), `/accounts`, `/transactions`.
- Their skeletons and empty states, so a loading picture never spans while its content does not.
- One new message key, `accounts.filter.count`, in EN + PL.
- Playwright assertions for each decision type, per the spec's acceptance criteria.

## Non-goals

- Narrow-viewport truncation (#17), dark-theme separation (#19), secondary-grey contrast (#20),
  missing empty/loading/error states (#21).
- The `/dashboard` header band — the passbook work (`cf483b7`, `11e8848`) already closed the defect
  #18 measured there; the spec re-asserts it rather than changing it (Step 5.2).
- The Net worth widget's mid-card void — filed as its own issue in Step 5.3, per spec Q10.
- Any new data on any screen; any server module, migration, or amount.
- A `<Well>` layout component, a density toggle, or widening `--content-max` — all rejected in the
  spec's Alternatives section.

## How this plan maps onto the spec's 24 Steps

The spec's Implementation Plan closes each of its six phases with a "capture and read frames" step
(1.5, 2.3, 3.4, 4.4, 5.4, 6.4) and those produce no commit — no PNG enters the repository
(`AGENTS.md` → Never). They map onto this engine's **checkpoint passes**, which is where the loop
engine puts screenshot evidence and posts it to the PR. Nothing is dropped: the frames are still
captured, read, and attached; they simply land on a checkpoint commit rather than on a Step of
their own. That leaves 18 commit-bearing Steps, one commit each.

Checkpoints therefore fire after Steps 1.4, 3.3, 4.3 and 5.3, and the final gate subsumes the
sixth.

## Why every Step is `inline`

Each Step is a one-to-three-line presentational change plus its assertion, and each depends on
vocabulary the main session already holds — `DESIGN.md`'s band names and Named Rules, the
repository's distinctive comment prose, the `token-classes` scanner's rules, and the e2e harness's
`gotoApp`/`useLocale`/`useTheme` conventions. Executor overhead would exceed the work and risk
stylistic drift on a change whose entire value is stylistic. This is the `inline` clause of
`references/executor-dispatch.md`, not an opt-out from it.

## Implementation Plan

### Phase 1 — The width vocabulary

Ships alone; **gates Phases 2 and 4**, which consume `max-w-list`.

**1.1 Add `--list-max: 56rem` to `tokens.css`**

- Beside `--content-max` (`src/styles/tokens.css:682`), with the comment shape the existing entry
  uses and its px equivalent (`896px`).
- Derivation to record in the comment: 896px against the 1156px of usable content width a 1440px
  viewport gives leaves a 260px tail — 22%, under issue #18's "roughly a third".
- _Verify:_ `pnpm typecheck`, `pnpm lint`, `pnpm build`.

**1.2 Expose `--container-list` in `app.css`**

- `--container-list: var(--list-max);` beside `--container-content` (`src/styles/app.css:163`), so
  Tailwind's container namespace makes it reachable as `max-w-list`.
- **No new test case and no red-then-green here.** `src/styles/__tests__/token-classes.test.ts`
  holds one generic case that scans `src/**/*.{ts,tsx}` for token-shaped classes; its docblock
  records that a token with no consumer is not checked. Phase 1 adds no consumer, so that test is
  green before and after and proves nothing about this Step. Step 2.1 owns the red-green.
- _Verify:_ `pnpm build`, then read the generated CSS for the `--container-list` declaration.

**1.3 Amend `DESIGN.md` → Layout with the three width bands**

- State the three bands, what each is for, the start-aligned rule, and that `prose-measure` sets
  leading and paragraph gap and is therefore not a width utility.
- _Verify:_ `pnpm check` clean on the touched file; the section names all three tokens.

**1.4 Cap the eight `_app` page subtitles with `max-w-prose`**

- `categories/index.tsx:152`, `transactions/groups.tsx:134`, `accounts/index.tsx:166`,
  `budgets/index.tsx:131`, `recurring/index.tsx:158`, `payees/index.tsx:131`, `goals/index.tsx:136`,
  `transactions/rules/index.tsx:244` — one class on each `<p>` and nothing else on those elements.
- This is what makes `DESIGN.md`'s existing claim ("no running text is uncapped") true.
- _Verify:_ a browser case asserting each subtitle's rendered width is ≤ 65ch at 1440px in both
  locales and that its computed `line-height` is unchanged from HEAD. `rules`, `groups`,
  `categories` and `payees` (the last only in `pl`) break the ceiling today and must visibly wrap.

### Phase 2 — `/categories` and `/transactions/groups` (cap)

**2.1 Cap the category tree at `max-w-list`**

- `src/routes/_app/categories/index.tsx`, start-aligned, covering the tree, its skeleton, and its
  empty and error states.
- **This is where Phase 1's token guard first bites.** Confirm the red-green Phase 1 could not show:
  delete `--container-list` from `app.css`, re-run `pnpm test src/styles/__tests__/token-classes.test.ts`
  — it must fail with `max-w-list` in `dead` — then restore it and watch it pass. Record the result;
  do not commit the deletion.
- _Verify:_ tree container ≤ 912px at 1440×900; unchanged at 360×800; the longest seeded category
  name renders in full.

**2.2 Cap the groups table container at `max-w-list`**

- `src/routes/_app/transactions/groups.tsx` — the `TableContainer`, the skeleton at line 88, and the
  empty state.
- _Verify:_ table container ≤ 912px at 1440×900; the four column headers still render; unchanged at
  360×800.

### Phase 3 — `/recurring` (earn, two panes)

Independent of Phase 1. The one phase that reorders a narrow viewport.

**3.1 Split `/recurring` into two panes and move `Due soon` after the list**

- Move `UpcomingPanel` (`src/routes/_app/recurring/index.tsx:185`) in the DOM to follow the series
  list **and** wrap both in `lg:grid-cols-[minmax(0,1fr)_20rem]` with `items-start`, in the same
  commit. The two are not separable: at HEAD the panel renders _before_ the series list in a
  single-column stack, so the DOM move alone is a visible reorder at every width with no grid to
  justify it.
- No `order`, no explicit `grid-row`/`grid-column` — `widget-grid.tsx`'s header comment forbids
  exactly that, and it is a 1.3.2 failure that only shows on a phone.
- _Verify:_ `pnpm test` green; at 1440×900 the two panes sit on one row and the series pane is
  ≤ 912px; at 1023px and 360px they stack in DOM order with `Due soon` **below** the series list;
  a browser case asserting the accessibility-tree order matches the visual order at both widths.

**3.2 Keep the rail's column when nothing is due**

- The rail must not become an empty 20rem column beside a full list, and must not appear and
  disappear between renders. `UpcomingPanel` already renders its own empty copy
  (`recurring.upcoming.empty` — the spec names this `recurring.due.none`, which is a different
  existing key; the rendered one is what the assertion targets). No new key.
- _Verify:_ a browser case on a workspace with series but nothing outstanding — the grid still has
  two columns and the rail's rendered width matches the populated case.

**3.3 Follow the split through `recurring-skeletons.tsx`**

- `RecurringListSkeleton` must have the loaded state's geometry: the same two-pane grid, the series
  pane's rows where they land, a reserved rail.
- _Verify:_ the skeleton's and the loaded state's pane widths match to within 1px.

### Phase 4 — `/budgets` (pair). Needs Phase 1.

**4.1 Lay the budget list out as a two-column grid from `lg`**

- `grid gap-4 lg:grid-cols-2` with `items-start` in `src/routes/_app/budgets/index.tsx`, leaving
  `BudgetCard` itself untouched. The list is a `<ul>` at HEAD and stays one.
- _Verify:_ with ≥3 budgets, two cards share a row at 1440×900 (equal `y`, differing `x`) and each
  is ≤ 620px; one column at 1023px and below.

**4.2 Render a single budget at `max-w-list`**

- A two-column grid with one child is the same fault at a smaller scale.
- _Verify:_ with exactly one seeded budget, card width ≤ 912px.

**4.3 Follow the pairing through `budget-skeletons.tsx` and the filtered empty state**

- `BudgetListSkeleton` and the archived-empty `Card` follow their container, so loading and empty do
  not span while the content does not (`docs/SPEC.md` §2.10).
- _Verify:_ a browser case on the loading and empty states.

### Phase 5 — `/dashboard` (the widget grid only)

The header band is out of scope, deliberately — see Non-goals.

**5.1 Stop the dashboard widget grid equalising row heights**

- `items-start` in `src/components/app/dashboard/widget-grid.tsx`, whose class list is
  `grid list-none grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3` at HEAD and therefore stretches
  every row item to the tallest.
- _Verify:_ with a seeded dashboard where two widgets on one row hold different amounts of content,
  their rendered heights differ at 1440×900; unchanged at 360×800; existing widget-grid tests green.

**5.2 Assert the dashboard header band still carries both ends**

- An assertion on existing behaviour, expected green on the first run, so the claim in this plan's
  Non-goals cannot rot silently.
- _Verify:_ a browser case asserting the header band carries a rendered node within 32px of each of
  its ends at 1440×900.

**5.3 File the Net worth mid-card void as a follow-up issue**

- Quote issue #18's measurement (~140px of dead space mid-card in Net worth), state why it is not
  here (vertical density inside a hand-rolled chart, ADR 0007; shares neither the decision rule nor
  the token), and record the issue number under Follow-ups below and in the PR body.

### Phase 6 — `/accounts` and `/transactions` toolbars (earn)

**6.1 Add `accounts.filter.count` to both catalogues**

- `src/lib/i18n/messages/en.ts` and `pl.ts` in the same commit, with the four Polish CLDR
  categories. EN reads `Showing {shown} of {total} accounts`.
- The plural branch is selected by `params.count` (`src/lib/i18n/interpolate.ts:70`), so the call
  site passes `count` as the plural driver alongside the two `formatNumber`-formatted values the
  message renders — the `members.seats.value` pattern.
- _Verify:_ the i18n parity test is green; a unit case asserting the Polish plural resolves for 1,
  2, 5 and 22.

**6.2 Give the `/accounts` filter band a counterweight at its end**

- The `SegmentedFilter` keeps the start of its band; the end carries the count, rendered **only**
  when the filter is actually narrowing the list (`Showing 12 of 12 accounts` is noise).
- _Verify:_ at 1440×900 the band carries a node within 32px of its end when a filter is active and
  none when it is not; at 360×800 the first account row is still above the fold in both locales;
  the filter's 44×44 targets are unchanged.

**6.3 Cap the `/transactions` search field from `md` up**

- `src/components/app/transactions/filter-bar.tsx:344` — replace `flex-1` from `md` up with a
  bounded width, so the three icon controls close up beside it into one start cluster.
- _Verify:_ at 1440×900 the gap between the field's end edge and the first icon control is under
  16px; below `md` the field still fills its row; every control keeps 44×44.

## Risks

- **Taste, not correctness.** 56rem is a judgement. Mitigated by being one token with a test beside
  it, by the per-surface tail assertion, and by frames read in both themes at each checkpoint.
- **Collision with #17.** Phases 1, 2, 4 and 5 change nothing below 1024px and assert it. Phase 3
  reorders `/recurring` at every width (no height added). Phase 6 **adds a node** to the `/accounts`
  band at every width — `accounts/index.tsx` already records what happened last time a header row
  grew there, so Step 6.2 carries an explicit above-the-fold assertion at 360×800 in both locales.
- **Rollback is not uniform.** Phase 1 is not independently revertible once Phase 2 or 4 has merged.
  Phase 6 additionally requires removing `accounts.filter.count` from **both** catalogues.
- **`pnpm e2e` is not in the validation gate** (it needs a running environment; CI runs it on every
  PR). The browser assertions this plan adds are therefore verified in CI, and locally at a
  checkpoint when the dev server can be started on an agent port (3011–3020).

## External References

None. No `--skill-url` was passed.

## Follow-ups

- Net worth widget mid-card void — filed in Step 5.3, issue number recorded here on landing.
