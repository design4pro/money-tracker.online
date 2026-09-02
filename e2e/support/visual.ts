import { expect, test } from '@playwright/test'

import type { Page, TestInfo } from '@playwright/test'

/**
 * The rule about *where* a baseline may be recorded and compared, and the wait that makes a frame
 * worth recording. One owner for both, because both are the kind of rule that rots into folklore
 * the moment there are two copies of it (`docs/SPEC.md` §8).
 *
 * ## Why baselines are Linux-only
 *
 * The recorded platform is Linux and only Linux, because Linux is what the gate runs on. The
 * alternative - a second `-darwin` set recorded on a laptop - buys a developer a green local run
 * and costs the project a second set of PNGs that has to be refreshed in lockstep with the first,
 * by whoever happens to own a Mac, or the gate starts disagreeing with itself.
 *
 * `{platform}` nonetheless stays in `snapshotPathTemplate`, and the reason is stronger here than
 * the antialiasing argument that used to be written in `playwright.config.ts`. This product loads
 * **no web font at all** - `src/styles/app.css` says so out loud, there is no `@font-face` and no
 * `public/` - so `--font-sans` falls all the way through `'Inter'`, `'Inter Fallback'` to
 * `-apple-system` on macOS and to `ui-sans-serif` on Linux. Those are not the same typeface with
 * different hinting; they are different typefaces, with different metrics, wrapping different
 * lines. No tolerance absorbs that, and no single un-suffixed baseline can serve both. So the
 * filename carries the platform that produced it, every recorded file ends in `-linux`, and a
 * `--update-snapshots` run on a Mac cannot silently overwrite the set CI compares against, because
 * the tests that would write it are skipped before they take a frame.
 *
 * That skip is the other half of the decision. A developer on a Mac runs `pnpm e2e` and gets the
 * whole suite minus the frames, with a reason naming the one command that records them, rather
 * than a wall of red that teaches them to distrust the suite.
 *
 * ## Why only two projects
 *
 * `ci.yml` runs the browser gate as a matrix of `chromium` and `mobile-safari`, and nothing else.
 * Recording a `webkit` set would produce baselines no gate ever compares, which is worse than
 * having none: they would drift unnoticed until the day somebody ran that project and read the
 * failure as a regression. So `webkit` is skipped here for the same reason and by the same
 * mechanism, and a local `--project=webkit` run passes rather than failing for want of files.
 */

/** The one platform baselines are recorded on. `process.platform`'s spelling, not Playwright's. */
const RECORDED_PLATFORM = 'linux'

/** The projects `ci.yml`'s `e2e` matrix actually runs. Keep the two in step. */
const RECORDED_PROJECTS: readonly string[] = ['chromium', 'mobile-safari']

/** How to record, quoted in the skip reason so it is never something to go and look up. */
const RECORD_COMMAND =
  'pnpm sandcastle:baselines (or the "Update e2e baselines" workflow)'

/**
 * Skips the calling test unless this run is one whose frames are recorded.
 *
 * Called from the first line of a test body rather than from a `beforeEach`: the project name is
 * only knowable at run time, so there is no collection-time form of this that also covers the
 * `webkit` half, and putting it in the body keeps the skip reason next to the frame it explains.
 */
export function skipUnlessBaselineTarget(testInfo: TestInfo): void {
  test.skip(
    process.platform !== RECORDED_PLATFORM,
    `Baselines are recorded on ${RECORDED_PLATFORM} only, because ${RECORDED_PLATFORM} is what CI ` +
      `runs; this is ${process.platform}. Record them with ${RECORD_COMMAND}.`,
  )
  test.skip(
    !RECORDED_PROJECTS.includes(testInfo.project.name),
    `Baselines exist for ${RECORDED_PROJECTS.join(' and ')} only, because those are the projects ` +
      `ci.yml runs; this is ${testInfo.project.name}.`,
  )
}

/**
 * Waits until the screen is the finished thing rather than its loading state.
 *
 * **This is the single most important line in a visual spec, and the reason is counter-intuitive.**
 * Playwright decides a screenshot is stable by taking frames until two match, and
 * `animations: 'disabled'` *cancels* an infinite animation to its initial state rather than
 * fast-forwarding it. `Skeleton` (`src/components/ui/skeleton.tsx`) animates `animate-shimmer`,
 * which is infinite. So a skeleton holds perfectly still under the camera: the stability check
 * passes, the frame is recorded, and the baseline is a photograph of a loading state that every
 * later run then has to reproduce exactly. A blank-looking diff is the *good* outcome there; the
 * bad one is a gate that has been green for a month over a page nobody has actually seen.
 *
 * So both halves below are load-bearing. The `ready` locator is the real assertion - it names
 * something only the settled screen has. The shimmer count is the backstop that catches a screen
 * which has *some* content and is still filling in a panel. If the utility class is ever renamed
 * the backstop silently stops backstopping, which is why it is not the only check.
 */
export async function waitForSettled(
  page: Page,
  ready: string,
  timeout = 20_000,
): Promise<void> {
  // A longer leash than the suite's 5s `expect` default, and `/transactions` is why: it is the one
  // screen on this list with no route loader, so its rows arrive from a client fetch *after*
  // hydration rather than in the document. Five seconds is the budget for an assertion against a
  // page that is already there; this is a wait for a round trip to a development server. The
  // caller may lengthen it - see `SLOW_SERVER_BUDGET` in `visual.spec.ts` - because a screen
  // reached by a client transition waits on a server *function* module, which `pnpm dev` compiles
  // on first call exactly as it compiles a route on first request. `/budgets/:id` is the one that
  // shows: it sits on "Loading this budget…" until that compile lands.
  await expect(page.locator(ready).first()).toBeVisible({ timeout })
  // `.animate-shimmer` is the only marker `Skeleton` offers - it is `aria-hidden`, so no role
  // reaches it. See the note above about why this is a backstop and not the assertion.
  await expect(page.locator('.animate-shimmer')).toHaveCount(0, { timeout })
  // Web fonts would be the other half of this wait. There are none: see the module docblock.
  await page.waitForLoadState('networkidle')
}
