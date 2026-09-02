import { expect, test } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './support/app'
import { storageStateFor } from './support/session'
import { skipUnlessBaselineTarget, waitForSettled } from './support/visual'

import type { AppLocale, AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * The visual-regression gate: every load-bearing screen, photographed and compared pixel for pixel.
 *
 * ## Why this is one file and not seven
 *
 * The six `*.visual.spec.ts` files next to this one are named for what they were meant to become
 * and contain axe scans and behavioural assertions instead - none of them has ever taken a
 * screenshot. Spreading frames across them would have put the recording rule (which platform,
 * which projects, which surfaces, what counts as settled) in six places, and a rule in six places
 * is a rule that gets widened in one of them by whoever is in a hurry. `docs/SPEC.md` §8: one
 * concept, one owner. The baselines are one concept. `.sandcastle/record-baselines.ts` already
 * assumed this file existed and says so - "scoped to visual.spec.ts: that is the only file that
 * owns baselines" - so this is the owner it was written against.
 *
 * ## The matrix, and why the locale axis earns its cost
 *
 * Seven surfaces × light and dark × English and Polish, on the two projects `ci.yml` runs.
 *
 * Theme is uncontroversial: `DESIGN.md` builds both palettes from one token layer, and a
 * mis-mapped token is invisible in the theme it was authored in.
 *
 * The locale axis doubles the PNG count, and it is worth it for a reason no assertion in this
 * suite can cover. Polish labels are longer than their English counterparts - "Nadchodzące" for
 * "Upcoming", "Saldo początkowe" for "Opening balance" - and what that does is wrap a button onto
 * two lines, push a card taller, or truncate a column header. Every one of those is a real defect
 * a reader would report, and every one of them passes `getByRole('button', { name })` without
 * complaint, because the accessible name is intact whatever the pixels do. A screenshot is the
 * only instrument in this repository pointed at that failure. The same two axes are the ones
 * `accessibility.spec.ts` argues for at length, so this file adds no new mental model.
 *
 * Width is deliberately not a third axis: `playwright.config.ts` owns the viewports, and
 * `mobile-safari` already runs this file at a phone width.
 *
 * ## Viewport frames, not full-page ones
 *
 * `toHaveScreenshot()` is left at its default, which photographs the viewport rather than the
 * whole scroll height, and that is a decision rather than an omission. A full-page frame of
 * `/transactions` is a picture of a virtualised list whose height depends on how many pages the
 * auto-loader happened to fetch, and a full-page frame of any list changes wholesale when one row
 * is added - so it fails loudly and uninformatively for a change that moved nothing. A bounded
 * frame catches what a visual gate is for: the composition, the spacing, the colour, the type.
 *
 * ## The demo workspace is read and never written
 *
 * Same contract the specs around this one keep, so `scripts/seed/verify.mjs` still finds every
 * counter it asserts after a run. Nothing here presses a button.
 *
 * **The budget create/edit dialog is deliberately not photographed.** Its period select is being
 * changed, and a baseline of it would be stale before it was committed.
 */

/**
 * One number for every wait in this file, and the ceiling that has to sit above their sum.
 *
 * Both are budgets, not tolerances. `maxDiffPixelRatio` and `threshold` are untouched: nothing
 * that differs by a pixel is accepted anywhere here, and a screen that never settles still goes
 * red. It is only given longer to say so.
 *
 * The number is sized by what actually failed, and every red this file produced while it was being
 * written had the same cause. `pnpm dev` compiles on demand: a route module the first time anyone
 * requests it, a client module graph the first time a browser hydrates that route, a server
 * function module the first time anyone calls it. This file opens seven screens exactly once each
 * and never returns to one, so every single thing it does is a first visit paying that cost -
 * where a functional spec drives one screen repeatedly and pays it once. That is why the reds came
 * as `page.goto`, `waitForFunction` and a `/budgets/:id` stuck on "Loading this budget…" rather
 * than as diffs, and why one budget covers all three: they are the same compile, in three places.
 *
 * The ceiling has to *exceed the sum* of those waits, or a frame fails on the outer clock with
 * "Test timeout exceeded" while the inner wait that was actually short of time never gets to name
 * itself. That is a confusing red, and it is the one this number exists to prevent. It costs
 * nothing on a green run: a passing frame here takes a few seconds.
 */
const SLOW_SERVER_BUDGET = 60_000
test.describe.configure({ timeout: 300_000 })

test.use({
  storageState: storageStateFor('demo'),
  // The navigation half of the same budget: `page.goto` here is a cold server render, every time.
  navigationTimeout: SLOW_SERVER_BUDGET,
})

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

interface Surface {
  /** Goes into the PNG's filename, so it is kebab-case and stable. */
  readonly name: string
  /** Reached by `gotoApp`, except `budget-detail`, which is resolved from the list. */
  readonly path?: string
  /**
   * Something only the settled screen has. See `waitForSettled`: without a positive assertion the
   * camera happily photographs a skeleton, because a cancelled infinite animation holds still.
   */
  readonly ready: string
}

/**
 * The screens a regression on would be noticed by a customer before it was noticed by us.
 *
 * `/recurring` and `/goals` are opened at `?status=all` for the reason their own specs give: the
 * default filter is `active`, and the seed derives status from the data rather than declaring it,
 * so a frame pinned to the default could honestly become a photograph of an empty state.
 */
const SURFACES: readonly Surface[] = [
  // Every chart ships a visually-hidden data table (`docs/ACCESSIBILITY.md`), so a table is the
  // cheapest proof the dashboard's panels have their numbers rather than their skeletons.
  { name: 'dashboard', path: '/dashboard', ready: 'table' },
  { name: 'accounts', path: '/accounts', ready: 'a[href^="/accounts/"]' },
  {
    name: 'transactions',
    path: '/transactions',
    ready: 'a[href^="/transactions/"]',
  },
  { name: 'budgets', path: '/budgets', ready: '[role="meter"]' },
  { name: 'budget-detail', ready: 'table' },
  {
    name: 'recurring',
    path: '/recurring?status=all',
    ready: 'a[href^="/recurring/"]',
  },
  { name: 'goals', path: '/goals?status=all', ready: '[role="meter"]' },
]

/**
 * Opens a surface, by address or - for the budget detail - by following the list.
 *
 * The detail screen is reached through its list rather than by a hard-coded id, which is the rule
 * `budget-detail.visual.spec.ts` states: a demo id written into a spec is a spec that starts
 * failing the day `scripts/seed/seed.mjs` renames a row, for a reason that has nothing to do with
 * the screen under test.
 *
 * The link is **clicked** rather than read off and navigated to. A second `page.goto` is a second
 * full document request, and against a development server that is a second SSR render of a route
 * the router would otherwise have transitioned to on the client - which is both slower and a
 * different code path from the one a reader takes. Waiting on the URL is what makes the click
 * safe: the list stays mounted while the loader runs, so an assertion about content would be
 * satisfied by the page being navigated away from.
 */
async function openSurface(page: Page, surface: Surface): Promise<void> {
  if (surface.path !== undefined) {
    await gotoApp(page, surface.path, SLOW_SERVER_BUDGET)
    return
  }

  await gotoApp(page, '/budgets', SLOW_SERVER_BUDGET)
  const link = page.locator('a[href^="/budgets/"]').first()
  await expect(link).toBeVisible()
  const href = await link.getAttribute('href')
  if (href === null) throw new Error('a budget row carried no href')
  await link.click()
  await page.waitForURL(`**${href}`)
}

for (const surface of SURFACES) {
  for (const theme of THEMES) {
    for (const locale of LOCALES) {
      test(`${surface.name} — ${theme}, ${locale}`, async ({
        page,
        context,
      }) => {
        // First line of the body rather than a `beforeEach`, so the skip reason is attached to
        // the test that would have taken the frame and a reader sees it next to the frame's name.
        skipUnlessBaselineTarget(test.info())

        await useLocale(context, locale)
        await useTheme(page, theme)
        await openSurface(page, surface)
        await waitForSettled(page, surface.ready, SLOW_SERVER_BUDGET)

        await expect(page).toHaveScreenshot(
          `${surface.name}-${theme}-${locale}.png`,
          {
            // Longer than the suite's 5s `expect` default, and this is a *budget*, not a
            // tolerance: `maxDiffPixelRatio` and `threshold` are untouched, so nothing that
            // differs is being accepted. What this buys is time for the camera to find two
            // consecutive identical frames. Mobile WebKit needs it on the chart-bearing screens,
            // because `chart-frame.tsx` paints once at its 640px fallback width and again at the
            // width its `ResizeObserver` measures - two legitimate renders, and the first one has
            // to be over before a frame means anything. A page that never settles still fails
            // here; it just takes longer to say so.
            timeout: 20_000,
          },
        )
      })
    }
  }
}
