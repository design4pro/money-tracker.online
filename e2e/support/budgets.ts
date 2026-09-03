import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

import type { Page } from '@playwright/test'

/**
 * The axe run the two budget specs share, and the shape of failure they report.
 *
 * `docs/plans/12-budgets.md` sets the bar at **zero `serious`, zero `critical`** on both budget
 * routes. That is narrower than `accessibility.spec.ts`, which fails on any WCAG A/AA violation at
 * any impact across the four unavoidable screens; this file is not a second copy of that net, it is
 * the per-route gate the plan names, and the two run side by side on purpose.
 *
 * `best-practice` is excluded for the reason `accessibility.spec.ts` gives at length: those rules
 * are not WCAG, and failing on one invites the next reader to widen an exclusion list rather than
 * fix a violation.
 *
 * No `aria-allowed-attr` correction is needed here. The budget meter is hand-written in
 * `src/components/app/budgets/budget-meter.tsx` with a single-token `role="meter"`, so the
 * axe-core fallback-role defect that `accessibility.spec.ts` documents for React Aria's `Meter`
 * does not reach this surface — and if a future edit swaps it for `ui/Meter`, this spec failing is
 * the correct outcome rather than something to forgive here.
 */

const WCAG_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
] as const

/** Runs axe over the whole document and asserts the plan's bar, naming what failed if it did. */
export async function expectNoSeriousViolations(
  page: Page,
  surface: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG_AA_TAGS])
    // The one exclusion, and it is not the widening the comment above warns about: this is not our
    // markup and no edit to this repository can fix it. React Aria keeps a single global live
    // region on `document.body` (`LiveAnnouncer.mjs:51` stamps `data-live-announcer`), and a
    // `Button` with `isPending` announces on both edges of the pending state, so a focused pending
    // button leaves two `role="img"` nodes whose `aria-labelledby` points at a control the flow has
    // already navigated away from. Axe reads that, correctly, as an image with no accessible name -
    // a true statement about a node that belongs to the library, is off-screen, and is gone a few
    // seconds later.
    //
    // What it replaces is worse than a false positive. The alternative was to wait the nodes out,
    // and the library removes them on a `setTimeout` inside the page (`:98`) - so a Playwright poll
    // running in Node proves the node is still there without proving the page's timers ever ran.
    // In CI they did not: the count sat at 2 across a 15s window, on both engines, and the wait ate
    // the whole remaining test budget and toppled the test on its 30s ceiling somewhere unrelated.
    // A gate must not bet on somebody else's timer, and it must not fail in a place that does not
    // name the reason.
    //
    // The scope is the region, not a rule: nothing inside `[data-live-announcer]` is ours, so
    // nothing that could be fixed is hidden. `.github/a11y/axe-scan.mjs` excludes the same region
    // for the same reason, and the two have to agree or the gates disagree about the same page.
    .exclude('[data-live-announcer]')
    .analyze()

  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === 'serious' || violation.impact === 'critical',
  )

  // The message carries the rule, the impact and the first offending node: a bare count tells
  // whoever reads the CI log nothing they can act on.
  expect(
    blocking.map(
      (violation) =>
        `${surface}: ${violation.id} (${violation.impact ?? 'unknown'}) — ${
          violation.nodes[0]?.html ?? 'no node'
        }`,
    ),
  ).toEqual([])
}
