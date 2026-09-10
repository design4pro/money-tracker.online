# Checkpoint 7 — the re-review, and the measurement error it caught in checkpoint 6

**UTC:** 2026-09-10T02:20:00Z
**Head:** `71b61bb` — fix(recurring): re-derive the rail track against the real badge, cap the stacked panes
**Steps covered:** `3.6-review-fix`.

The second `om-auto-review-pr 156 --autofix` pass ran over the diff as it stood at `701dd9c`. It
returned **request changes** with two majors and one minor, and both majors were about the fix
checkpoint 6 had just shipped. That is the finding worth recording: the first pass found a real
defect, the fix for it was derived against a stand-in rather than the real component, and the
assertion written to protect the fix could not have failed.

Both majors were re-derived from a command whose output was read before anything changed. Both
held.

## 1. Major 1 — the rail track was measured against markup that cannot overflow

`e2e/desktop-density.spec.ts` proves the rail holds its table by injecting the status column a late
period adds. Checkpoint 6 built that column by hand:

```
rounded-full px-2 py-0.5 text-caption   +   the English word 'Overdue' in both locales
```

The real column is `PeriodStatusBadge` → `Badge` (`src/components/ui/badge.tsx:9,37`), whose
variant string is

```
inline-flex shrink-0 items-center gap-1 rounded-sm border font-semibold whitespace-nowrap
h-6 px-2 text-caption border-transparent bg-negative-soft text-negative
```

and whose Polish text is `Po terminie`, not `Overdue`. Two differences matter and one does not:
`whitespace-nowrap` (a stand-in without it can be broken by the browser at the space, so it can
never widen the column past its longest word) and the locale word (`Po terminie` is 11 characters
against `Overdue`'s 7). `font-semibold` inside a border adds the rest.

Measured at 1440×900, both locales, `scrollWidth` of the `Due soon` table before and after
injecting each version of the column:

```
STAND-IN  en  before={"s":406,"c":406}  after={"s":406,"c":406}
STAND-IN  pl  before={"s":406,"c":406}  after={"s":406,"c":406}
REAL      en  before={"s":406,"c":406}  after={"s":406,"c":406}
REAL      pl  before={"s":406,"c":406}  after={"s":419,"c":406}
```

The stand-in never moved the number. The real badge moves it to **419px in `pl`** — 13px past what
a `28rem` track leaves. So the rail shipped one locale short, and the test that existed to catch
exactly this stayed green.

### The red proof

With `STATUS_COLUMN` quoting the real variant string and both locale words, against the `28rem`
track:

```
✘ the /recurring rail holds its own table rather than scrolling it — pl
  Expected: <= 406
  Received: 419
  ✓ … — en   (passed)
```

`en` passing and `pl` failing is the exact shape the reviewer predicted, and the exact shape the
stand-in was hiding.

### The fix

`30rem` on the rail track, which leaves **438px** of content:

```
LATE  en {"s":438,"c":438}
LATE  pl {"s":438,"c":438}
```

438px against a 419px worst case is 19px of headroom for the next word Polish grows. The panes at
the widths that matter, both locales identical:

```
PANES vw=1280 [492,480]   vw=1440 [652,480]   vw=1680 [712,480]
```

`src/components/app/recurring/panes.ts` now records both numbers **and** the wrong one, so the next
reader knows the 406px in checkpoint 6 was derived against a stand-in and superseded here.

## 2. Major 2 — moving the split to `xl` left 1024–1279 uncapped

Checkpoint 6 moved the pane split from `lg` to `xl` for a good reason (at 1024px a 30rem aside
leaves the series list 230px). It did not notice what that hands back: between 1024 and 1279 the
page is a single column again, and a single column left alone takes the entire well — which is
finding 1 of issue #18, on the surface the issue names.

Measured at 1279×900:

```
✘ /recurring stacks its two panes below xl, in DOM order, capped at the band — en
  Expected: <= 912
  Received: 995
  ✘ … — pl   same numbers
```

### The fix

One class pair on the shared constant rather than the per-child change the reviewer suggested:

```ts
'grid max-w-list items-start gap-6 xl:max-w-none xl:grid-cols-[minmax(0,1fr)_30rem]'
```

`max-w-list` below `xl`, dropped at `xl` where both tracks are already narrower than the band and
the cap would only shrink a row it is meant to leave alone. Because `RECURRING_PANES` is the
constant both the screen and `recurring-skeletons.tsx` import, the loading picture follows without
a second edit — which is the reason the constant exists.

The stacking case is now asserted at three widths (`1279`, `1023`, `360`), and at each one both
panes are checked against the band, not only their order.

## 3. Minor — three stale `lg` references

`recurring/index.tsx:193` (second paragraph of the route docblock),
`recurring-skeletons.test.tsx:11`, and the PR body still said the panes split at `lg`. All three
corrected. `PLAN.md` also carried a dead SHA — `359e60e`, the pre-amend hash of `d7490fc` — now
`d7490fc`.

## 4. Deferred, not silently dropped (AGENTS.md → Ask First)

Three review suggestions were **not** applied, because applying them would delete or weaken an
assertion, which needs a human's yes:

- `WidgetFrame`'s `height` prop, called dead configuration. Removing it deletes a test assertion.
- `desktop-density.spec.ts:754`'s exact-float `toBe`. `toBeCloseTo` narrows what it asserts.
- The `/recurring` skeleton's missing filter row. Pre-existing, and out of this spec's scope.

Two pre-existing heading skips found while fixing the outline (`groups.tsx:156`'s `EmptyState`
defaulting to `headingLevel` 3, `candidate-card.tsx:66` still `h3`) were filed as **#166** rather
than folded in, together with widening the outline test over `SUBTITLE_ROUTES`.

## 5. Gate at `71b61bb`

| Command                                                                 | Result                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `node .ai/scripts/agent-kit-check.mjs`                                  | ok                                                    |
| `pnpm generate-routes` + `git diff --exit-code -- src/routeTree.gen.ts` | no drift                                              |
| `pnpm db:generate < /dev/null` + `git diff --exit-code -- drizzle/`     | no drift                                              |
| `pnpm typecheck`                                                        | ok                                                    |
| `pnpm lint`                                                             | 0 errors, 2 warnings (both pre-existing on `develop`) |
| `pnpm test`                                                             | **163 files, 2465 passed**                            |
| `pnpm build`                                                            | ok                                                    |
| `pnpm exec prettier --check` on the five touched files                  | clean                                                 |

## 6. Browser runs at `71b61bb`

```
chromium  101/101 passed (2.3m)
          desktop-density + accessibility + recurring.visual + narrow-viewport + budgets.visual
webkit     52/56 passed (53.0s)
          desktop-density + recurring.visual
```

The four webkit failures are all `pl`, all on `/budgets` and `/dashboard`, and all reproduce the
pre-existing **#163** `formatCalendarDateRange` WebKit/ICU hydration mismatch
(`+ 01–31.08.2026` client against `- 1–31 sie 2026` SSR, `budget-card.tsx:100`) at call sites this
branch does not touch. None of them is on `/recurring`, the surface this checkpoint changed.

## 7. Frames

`.ai/qa/artifacts_issue-18/review-fix-2/`, `/recurring` at 1440, 1280, 1152 and 360 in both themes,
`captureValid: true`, no fatal console output. Read at 1440 light (two panes, table columns clear
of each other), 1152 light (stacked in DOM order, both panes ending at the same edge as the filter
rule) and 360 dark (stacked, the table inside the card at phone width). Nothing entered the
repository — `.gitignore:32` covers `.ai/qa/artifacts_*/`.
