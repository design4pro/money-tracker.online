import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './support/console'

import { openSurface, SURFACES } from './support/surfaces'

import type { AppTheme } from './support/app'
import type { Violation } from './support/axe-defects'
import type { Page } from '@playwright/test'

/**
 * The 7:1 text floor, on a rendered page, in both themes, at rest **and under the pointer**.
 *
 * ## Why this is a separate file from `accessibility.spec.ts`
 *
 * That file guards the conformance claim: WCAG 2.2 A and AA, which is what `docs/SPEC.md` §10
 * permits the product to say and what the CI gate enforces. This one guards something narrower and
 * self-imposed — the palette is *designed* to a 7:1 text contrast floor (1.4.6's threshold) with
 * two named exceptions, and `docs/ACCESSIBILITY.md` says so in as many words. A failure here is not
 * an AA regression; it is the product's own design contract breaking, which is a different
 * conversation and deserves its own red.
 *
 * ## Why hover is the state that matters
 *
 * `src/styles/__tests__/tokens-contrast.test.ts` proves every text token clears 7:1 on every
 * *opaque* ground in both themes, by arithmetic, without a browser. What arithmetic over token
 * pairs cannot see is a translucent wash: `--color-hover` is painted **over** whichever plane a row
 * sits on, so a hovered row's ground is a composite that appears in no token file. Axe never
 * hovers; neither did anything else here. That is the gap issue #20 measured — secondary text under
 * the wash fell to 6.73:1 in dark, over AA and under the floor the palette claims, with nothing in
 * the repository looking at it.
 *
 * The remedy was to promote that text to `ink` under the wash (`rowWash` / `rowWashSecondary` in
 * `src/components/ui/shared.ts`). This file is what stops the promotion being quietly removed:
 * delete it and the hovered half of every case below goes red.
 *
 * ## Why it asserts that it sampled something
 *
 * The failure mode of a colour scan is not a false pass on a bad pair — it is not looking at the
 * pair at all. A selector that stops matching, a route that renders an empty state, a rule that is
 * off by default: each produces zero violations and reads exactly like success. So every case
 * states how many nodes axe actually put a number on, and fails when that number is zero.
 */

/** Off by default in axe-core, because it is AAA. `withRules` enables it explicitly. */
const ENHANCED_RULE = 'color-contrast-enhanced'

const THEMES: readonly AppTheme[] = ['light', 'dark']

/**
 * Every element carrying `rowWash`.
 *
 * `[class~=…]` matches one whitespace-separated token, which is exactly what a Tailwind named group
 * is: the literal class `group/wash`. Addressing the pattern rather than a per-route selector means
 * a list that adopts the wash later is covered on the day it does.
 */
const WASH_ROW = '[class~="group/wash"]'

/**
 * How many rows of one list are hovered.
 *
 * A ceiling rather than "all of them", because `/transactions` seeds fifty rows of one component
 * and the fifty-first proves nothing the tenth did not. The seeded lists that vary row to row —
 * accounts, budgets, goals, recurring — are all shorter than this, so the cap only ever bites on
 * the one list where every row is the same shape.
 */
const ROW_SAMPLE_LIMIT = 10

/**
 * Marks the one row currently under the pointer, so the hovered scan reads that row and no other.
 *
 * Scoping each pass to `WASH_ROW` instead re-measured every row on the page on every iteration —
 * fifty rows times ten hovers on `/transactions`, which walked past the 30 s test budget without
 * ever reporting a pair. Nine of those ten passes were also measuring the *resting* state, so the
 * cost bought nothing: only the hovered row sits on the composited ground this file exists for.
 *
 * Narrowing the include does not narrow what axe knows. Background colour is resolved by walking
 * the ancestors of the node under test, so the row's own wash and the plane beneath it are both
 * still in the composite; `include` decides which nodes get a number, not where the colour under
 * them comes from.
 */
const PROBE_ATTRIBUTE = 'data-wash-probe'
const PROBE = `[${PROBE_ATTRIBUTE}]`

/**
 * Long enough for `--duration-fast` (150ms in `src/styles/tokens.css`) to finish.
 *
 * Both halves of the wash are transitions — the ground and the promoted text — so the pair a
 * reader actually sees is the one at the *end* of the fade, not at its start.
 */
const TRANSITION_SETTLE_MS = 250

/**
 * The surfaces with no washed rows, written down so their absence is a claim rather than a gap.
 *
 * `/` and `/login` are marketing and a form; `/dashboard` draws its account lines inside widgets
 * that are not row targets, at rest; `/categories` is a `GridList`, whose rows carry their own
 * hover treatment on `GridListItem` and whose only secondary-ink descendants are decorative icons
 * — a 3:1 question (§1.4.11), not a 7:1 one. `/accounts/groups` is a `GridList` too, but its rows
 * do carry secondary text (the account names and the count). It is listed because those rows
 * take no `rowWash`, not because nothing there needs a number: pointing the hovered scan at every
 * `role="row"` there (a throwaway edit of `WASH_ROW`) held the floor in both themes.
 */
const NO_WASH_ROWS: readonly string[] = [
  '/',
  '/login',
  '/dashboard',
  '/categories',
  '/accounts/groups',
]

interface Measured {
  readonly violations: readonly Violation[]
  /** Nodes axe actually put a number on: passes plus anything it could not decide. */
  readonly sampled: number
}

async function measure(page: Page, include?: string): Promise<Measured> {
  const builder = new AxeBuilder({ page }).withRules([ENHANCED_RULE])
  const results = await (
    include === undefined ? builder : builder.include(include)
  ).analyze()

  const nodesOf = (group: ReadonlyArray<{ id: string; nodes: unknown[] }>) =>
    group
      .filter((rule) => rule.id === ENHANCED_RULE)
      .reduce((total, rule) => total + rule.nodes.length, 0)

  return {
    violations: results.violations,
    sampled: nodesOf(results.passes) + nodesOf(results.incomplete),
  }
}

/**
 * A failure that names the pair, not just the rule.
 *
 * Axe records both colours and the ratio it computed on every node it fails, and those three
 * numbers are the whole finding — a bare selector sends the next reader back to the browser to
 * re-measure what the run already knew.
 */
function report(violations: readonly Violation[], label: string): string {
  const lines = violations.flatMap((violation) =>
    violation.nodes.slice(0, 6).map((node) => {
      const data = node.any.find((check) => check.data != null)?.data as
        | { fgColor?: string; bgColor?: string; contrastRatio?: number }
        | undefined
      const measured =
        data?.contrastRatio === undefined
          ? (node.failureSummary ?? '').replace(/\s+/g, ' ').trim()
          : `${data.fgColor} on ${data.bgColor} is ${data.contrastRatio}:1`
      return `  - ${node.target.join(' ')}\n    ${measured}`
    }),
  )
  return `${lines.length} text pair(s) below 7:1 on ${label}:\n${lines.join('\n')}`
}

/** The assertion, written so a failure prints the ratios rather than a bare count. */
function expectClear(measured: Measured, label: string): void {
  expect(
    measured.violations
      .flatMap((violation) => violation.nodes)
      .map((node) => node.target.join(' ')),
    report(measured.violations, label),
  ).toEqual([])
  expect(
    measured.sampled,
    `${label}: axe measured no text at all, so this pass proves nothing`,
  ).toBeGreaterThan(0)
}

test.describe('enhanced contrast', () => {
  for (const surface of SURFACES) {
    for (const theme of THEMES) {
      // One locale, and one page load for both states. Contrast is a property of the palette and
      // the layout, and both are the same in Polish; `accessibility.spec.ts` is where a translated
      // accessible name is checked.
      test(`${surface.name} holds the 7:1 text floor · ${theme}`, async ({
        browser,
        contextOptions,
      }) => {
        // One case here is eleven axe passes — one at rest and one per hovered row — where an
        // ordinary spec is one page load and a handful of assertions. `/transactions` measured 6.8 s
        // of that on a quiet machine and walked past the default 30 s as soon as workers were
        // competing for the single Vite dev server they all share, which is the contention
        // `playwright.config.ts` already names. CI answers it with one worker, but on a 2-vCPU
        // runner those eleven passes have correspondingly less to spend. `slow` states the shape of
        // the work rather than thinning the sample until the clock stops mattering.
        test.slow()

        const { context, page } = await openSurface(
          browser,
          contextOptions,
          surface,
          theme,
          'en',
        )

        try {
          expectClear(await measure(page), `${surface.name} · ${theme} · rest`)

          const rows = page.locator(WASH_ROW)
          if (NO_WASH_ROWS.includes(surface.path)) {
            // Asserted rather than assumed, in both directions: the day one of these grows a
            // washed list, this goes red and the hovered half starts running for it.
            await expect(
              rows,
              `${surface.name} is listed as having no \`${WASH_ROW}\` rows, and now has some`,
            ).toHaveCount(0)
            return
          }

          // Waited for, not counted. `/transactions` is a virtualised grid, and `openSurface`
          // returns as soon as `main` and the heading are up — a bare `count()` there raced the
          // first paint of the body and read zero, which is the shape of a green scan that
          // measured nothing. This is the whole reason `expectClear` also asserts `sampled`.
          await expect(
            rows.first(),
            `${surface.name} renders no \`${WASH_ROW}\` row; if that is deliberate, say so in NO_WASH_ROWS`,
          ).toBeVisible()
          const total = await rows.count()

          // Every row, not just the first: rows of one list are *not* interchangeable here. A
          // credit account draws a utilisation meter no current account has, an archived budget
          // sits on the sunken plane rather than on `surface`, and a foreign-currency account is
          // the only one with a converted line. Hovering row one and calling the list covered is
          // how the meter caption below survived the first draft of this file.
          for (
            let index = 0;
            index < Math.min(total, ROW_SAMPLE_LIMIT);
            index++
          ) {
            const row = rows.nth(index)
            await row.scrollIntoViewIfNeeded()
            await row.hover()
            const hovered = await row.evaluate((element, attribute) => {
              element.setAttribute(attribute, '')
              return element.matches(':hover')
            }, PROBE_ATTRIBUTE)
            expect(
              hovered,
              `${surface.name}: row ${index} did not take :hover, so this scan is the resting state`,
            ).toBe(true)

            // The promotion fades rather than snapping (`rowWashPromote`), so a scan taken the
            // instant the pointer lands reads a colour part-way between `ink-2` and `ink` — which
            // in dark is the failing ratio this file exists to catch, reported against a state no
            // reader ever rests on. Wait out the token that governs the fade. A fixed wait rather
            // than a `transitionend` race: the event bubbles from whichever descendant happens to
            // transition, so there is no single element to listen on, and this is a duration the
            // stylesheet declares rather than a guess.
            await page.waitForTimeout(TRANSITION_SETTLE_MS)

            const measured = await measure(page, PROBE)
            await row.evaluate(
              (element, attribute) => element.removeAttribute(attribute),
              PROBE_ATTRIBUTE,
            )
            expectClear(
              measured,
              `${surface.name} · ${theme} · row ${index} hovered`,
            )
          }
        } finally {
          await context.close()
        }
      })
    }
  }
})
