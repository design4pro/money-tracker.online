# Checkpoint 6 — the review pass, and the three findings it survived

**UTC:** 2026-09-10T00:55:00Z
**Head:** `d7490fc` — fix(recurring): widen the Due soon rail to hold its table, and split at xl
**Steps covered:** `6.4-review-fix`, `3.4-review-fix`, `3.5-review-fix`.

`om-auto-review-pr 156 --autofix` ran the `om-code-review` engine over the whole diff. It returned
**request changes** with three majors. None of them was accepted on the reviewer's word: each was
re-derived from a command whose output was read, and only then fixed. Two of the three turned out
to be regressions this branch introduced and did not notice, which is the point of the pass.

## 1. The three findings, measured

### Major 1 — the `/accounts` filter rule stopped spanning the band (`ee3ffb4`)

Step 6.2 wrapped the segmented control and the new count in
`<div className="flex flex-wrap items-center justify-between …">`. That made `SegmentedFilter` a
flex item, and a flex item is as wide as its content. Measured at 1440×900 on `/accounts`:

```
MAJOR1 radiogroup={"x":252,"y":426.4,"width":438.375,"height":45}
       wrapper={"x":252,"y":426.4,"width":1156,"height":45}
       borderBottom=1px
       list={"x":252,"y":528.4,"width":1156,"height":288.7}
```

The control's own `border-b border-border-subtle` therefore ran 438px inside a 1156px band. That
is load-bearing rather than decorative: the first account group below carries
`first:border-t-0 first:pt-0` precisely because it sits on this rule instead of drawing a second
one 16px under it, and the comment above the group says so in as many words. From x≈690 outward
the group sat on nothing.

**Fixed** by moving `border-b border-border-subtle` onto the wrapper and passing
`className="border-b-0"` to the control, which `cn`'s `tailwind-merge` resolves against the
component's own class list. The new case asserts the band carries the rule, the control does not,
and the band's `x` and `width` match the account list's to the pixel — in both locales.

### Major 2 — `/recurring`'s outline skipped a level (`cef03d8`)

Step 3.1 moved `Due soon` after the series list, which is the right reading order. It also moved
that panel's `h2` after the cards' `h3`s. Read from the rendered page:

```
MAJOR2 [ {"tag":"H1","text":"Recurring"},
         {"tag":"H3","text":"Netflix"},
         {"tag":"H3","text":"Tauron"},
         {"tag":"H3","text":"Wynagrodzenie"},
         {"tag":"H2","text":"Due soon"} ]
```

`h1 → h3` is a skip. It passed the a11y suite because axe's `heading-order` rule carries the
`best-practice` tag and `e2e/accessibility.spec.ts:52` excludes that tag.

The cards were never subsections of `Due soon` — they only read that way while the panel happened
to come first — so the fix is the level the card should always have had. `SeriesCard` has exactly
one production consumer (`routes/_app/recurring/index.tsx`); nothing else asserts its level.

**Fixed** by promoting the card's heading to `h2`. The new case reads the rendered heading
sequence on `/recurring` and requires that no level rises by more than one.

### Major 3 — the `Due soon` rail scrolled sideways at 1440 (`d7490fc`)

`RECURRING_PANES` stated a fixed `20rem` rail. `Card padding="md"` leaves 278px inside it, and the
panel's table needs more than that. Measured at 1440×900, both locales, with the status column
injected the way the panel prints it when a period is late:

```
RAILNEED en three={"scrollWidth":290,"clientWidth":278} four={"scrollWidth":381,"clientWidth":278}
RAILNEED pl three={"scrollWidth":298,"clientWidth":278} four={"scrollWidth":389,"clientWidth":278}
```

So the rail arrived on a 1440px desktop already scrolling — a horizontal scrollbar on an aside
whose whole job is to be read at a glance — before any row was late.

`28rem` leaves 406px, which is the smallest track that holds the widest state. Re-measured after
the change, `scrollWidth` and `clientWidth` are both 406 in both locales, with and without the
injected status column.

**A rail that wide cannot start at `lg`,** and that is a measurement too. The page column across
viewports, with a 28rem rail:

```
BAND vw=1024 grid=740  panes=[268,448]
BAND vw=1152 grid=868  panes=[396,448]
BAND vw=1280 grid=996  panes=[524,448]
BAND vw=1440 grid=1156 panes=[684,448]
BAND vw=1680 grid=1216 panes=[744,448]
```

268px for the series list at 1024px is the phone-list-in-a-desktop-band this whole spec exists to
remove, reintroduced on the pane that matters. So the split moved to `xl`: below it the rail
stacks under the list and takes the full column, where its table has more room than it can use.

**This is a deliberate deviation from the spec**, which says "two panes on one row from `lg`". It
is recorded here, in `panes.ts`, in the commit message and in the PR body, because the spec's own
decision rule — earn the width where there is width to earn — is what produced it.

The skeleton needed no change: it renders `RECURRING_PANES`, which is the reason that constant
exists. `RAIL_TRACK` in the suite follows it, and the stacking assertion gained 1279 beside the
1023 and 360 it already read.

## 2. Every new case proven red before it went green

`src/` reverted to the pre-fix state with the new assertions in place, `--project=chromium
--no-deps --workers=1`:

```
6 failed
  › /recurring reads as one outline with no heading level skipped — en
  › the /recurring rail holds its own table rather than scrolling it — en
  › /recurring reads as one outline with no heading level skipped — pl
  › the /recurring rail holds its own table rather than scrolling it — pl
  › the /accounts filter rule still reaches the end of the band — en
  › the /accounts filter rule still reaches the end of the band — pl
```

with `Expected: > 0 / Received: 0` on the band's `border-bottom-width` — the rule that was not
there.

## 3. The gate, re-run at `d7490fc`

| #   | Command                                                                 | Result                                             |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| 0   | `node .ai/scripts/agent-kit-check.mjs`                                  | **pass** — 32 managed files match the lock, kit 16 |
| 1   | `pnpm generate-routes` + `git diff --exit-code -- src/routeTree.gen.ts` | **pass** — no drift                                |
| 2   | `pnpm db:generate < /dev/null` + `git diff --exit-code -- drizzle/`     | **pass** — no drift                                |
| 3   | `pnpm typecheck`                                                        | **pass**                                           |
| 4   | `pnpm lint`                                                             | **pass** — 0 errors, 2 pre-existing warnings       |
| 5   | `pnpm test`                                                             | **pass** — **2465 passed, 163 files**              |
| 6   | `pnpm build`                                                            | **pass**                                           |

### The one failing test in the final-gate run is settled: it was a flake

`final-gate-checks.md` was written against a gate whose `pnpm test` reported
`1 failed | 2464 passed (2465)`. The only difference between that head (`16f294d`) and the
previous green one (`3da2811`) is markdown inside the run folder, so no code could have caused it.
Re-run on the same commit, unchanged: **163 files passed, 2465 tests passed, exit 0**. The captured
log had been filtered to its summary lines, so the failing file's name is not recoverable; what is
recorded is that the same commit is green on re-run, which is the same shape as the
`dashboard-data.test.ts` 5s load timeouts checkpoints 1-3 saw and checkpoints 4 onward did not.

## 4. Browser suites, run serially

`--workers=1`, against the shared environment at `http://127.0.0.1:3016`.

- **chromium** — `desktop-density` + `accessibility` + `recurring.visual` + `narrow-viewport`:
  **94 passed, 0 failed.** That is every new case, in both locales, plus axe over `/recurring` in
  light and dark and the 360px suite that covers the same two screens.
- **webkit** — `desktop-density` + `recurring.visual`: **52 passed, 4 failed.** All four are `pl`
  and all four are **#163**, the pre-existing WebKit/ICU disagreement on
  `formatCalendarDateRange`, reproduced here with the same diff React prints:

  ```
  <span data-tsd-source="/src/components/app/budgets/budget-card.tsx:100:17">
  +   01–31.08.2026        (WebKit, client)
  -   1–31 sie 2026        (SSR)
  ```

  Neither call site is touched by this branch, and `final-gate-checks.md` §2 records the run
  against `origin/develop`'s `src/` that produced the identical four. **Every `/recurring` and
  `/accounts` case in this checkpoint passes on WebKit**, including all six new ones.

## 5. Frames

`.ai/qa/artifacts_issue-18/review-fix/`, twelve PNGs at 1440, 1152 and 360 in light and dark for
`/accounts` and `/recurring`, captured with `scripts/visual/capture.mjs` and read. `capture.mjs`
has no locale flag, so they are `en`; the locale-sensitive claims in this checkpoint are the
measured ones above, which were taken in both. Nothing enters the repository (`AGENTS.md` → Never;
`.gitignore:32` covers `.ai/qa/artifacts_*/`).

Read from them: the `/accounts` filter rule now runs the full width of the band above the first
group, and `Due soon` at 1440 holds its table inside the card with no scrollbar and no clipped
column. At 1152 the rail is stacked under the list at the full column width, which is the `xl`
split doing what it was moved for.
