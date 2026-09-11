import { expect } from '@playwright/test'

import type { Page } from '@playwright/test'

/**
 * One screen's heading outline, read the way a screen reader announces it.
 *
 * ## Why this is hand-rolled rather than left to axe
 *
 * The rule that catches a level skip is axe's `heading-order`, and `heading-order` is tagged
 * `best-practice`. `support/axe-scan.ts` scans `WCAG_AA_TAGS` and says why `best-practice` is not
 * among them: those rules are not success criteria, and a gate that fails the build on them would
 * be failing it on something this product has not claimed. So the scan cannot see a level skip —
 * by construction, not by oversight.
 *
 * What the product *has* claimed is narrower and explicit: `docs/ACCESSIBILITY.md` → **2.4.10
 * Section Headings** states that every screen uses a correct heading hierarchy. That sentence needs
 * a guard of its own, and this is it. It asserts exactly the claim and nothing broader.
 *
 * Extracted from `desktop-density.spec.ts`, where issue #166 found the first copy guarding a single
 * route while two other screens rendered `h1` then `h3`. One definition, one owner
 * (`docs/SPEC.md` §8) — the same reason `axe-scan.ts` exists.
 *
 * ## `main`, not the document
 *
 * The application shell's rail and header sit outside `main` and carry no headings a reader
 * navigates the *screen* by. Scoping to `main` is what makes the first heading the page title
 * rather than whatever the chrome happens to render first.
 */

/**
 * Fail the test if `page`'s `main` does not read as one outline: an `h1` first, then no jump of
 * more than one level between consecutive headings.
 *
 * `label` names the screen in the failure — a bare "expected 3 to be ≤ 2" is a failure nobody can
 * reproduce, so the message carries the route and both headings of the offending pair.
 */
export async function expectOutlineWithoutSkips(
  page: Page,
  label: string,
): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  const headings = await page
    .locator('main :is(h1, h2, h3, h4, h5, h6)')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        level: Number(element.tagName.slice(1)),
        text: element.textContent.replace(/\s+/g, ' ').trim(),
      })),
    )

  expect(
    headings.length,
    `${label}: no heading inside <main>, so there is no outline to read`,
  ).toBeGreaterThan(0)

  const first = headings[0]
  expect(
    first.level,
    `${label}: the first heading inside <main> must be the page title, and it is “${first.text}”`,
  ).toBe(1)

  // A short list of `h1 “Groups” → h3 “No groups yet”` lines rather than a boolean: when a screen
  // skips twice the reader needs both, and when it skips once the message already names the pair.
  const skips = headings
    .slice(1)
    // `index` is the position in the sliced array, so it addresses the *previous* heading in the
    // original one. That off-by-one is the whole pairing.
    .map((heading, index) => ({ heading, previous: headings[index] }))
    .filter(({ heading, previous }) => heading.level - previous.level > 1)
    .map(
      ({ heading, previous }) =>
        `h${previous.level} “${previous.text}” → h${heading.level} “${heading.text}”`,
    )

  expect(
    skips,
    `${label}: the outline skips a heading level, so a reader navigating by heading hears a ` +
      `subsection that has no section:\n  ${skips.join('\n  ')}`,
  ).toEqual([])
}
