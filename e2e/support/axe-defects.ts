import type AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

/**
 * The corrections both axe runners apply, and the reason they live in one file.
 *
 * Two things in this repository run axe over the same pages: `e2e/accessibility.spec.ts` under
 * Playwright, and `.github/a11y/axe-scan.mjs` under the accessibility workflow. A correction held
 * by only one of them is worse than no correction at all - a page then passes one gate and fails
 * the other, and whichever gate is louder that week decides what the product is allowed to look
 * like. The live-announcer exclusion is already duplicated across the two by hand and says so in
 * both places; this one is too delicate for that. It turns on an exact role string, an exact set of
 * four attribute names and a re-check date, and two copies of those would drift on the first edit.
 *
 * So it is written once and imported by both. The scan is plain `.mjs` and runs under `tsx` for
 * exactly this reason - the alternative was a second copy of the reasoning below.
 */

/**
 * Axe's own result shapes, read off the builder rather than imported from `axe-core`.
 *
 * `axe-core` is a transitive dependency here - `@axe-core/playwright` depends on it, nothing in
 * this repository declares it - so importing its types directly resolves under a hoisting node
 * layout and fails under pnpm's. Deriving them from the method that returns them cannot drift.
 */
type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>
export type Violation = AxeResults['violations'][number]

type NodeResult = Violation['nodes'][number]

/**
 * The ARIA **fallback role list** React Aria puts on every `Meter`.
 *
 * ARIA 1.2 defines `role` as a *space-separated list of role tokens* and requires a user agent to
 * take the first token it supports. That is the standard way to ship a newer role with an older one
 * behind it, and `@react-aria/meter` emits exactly this list on purpose — its own comment cites the
 * Chromium and Firefox bugs for `meter` as the reason. Both have long since shipped it (Firefox 93,
 * October 2021), so the second token is vestigial for every engine this product is tested in. It is
 * still upstream's call to make, not this repository's to rewrite at runtime.
 *
 * And the list is not a prop this side can override. `useMeter()` returns it inside `meterProps`,
 * and `Meter` in `react-aria-components` spreads `meterProps` **last** in its `mergeProps` call, so
 * it wins over anything passed in. Dropping the second token means either writing to the DOM node
 * behind React's back after mount or forking the component — which is why this file, not the
 * component, carries the correction. `docs/ACCESSIBILITY.md` §5.5 weighs both.
 */
export const RAC_METER_FALLBACK_ROLE = 'meter progressbar'

/**
 * The four value attributes ARIA 1.2 allows on `meter`. Nothing else is forgiven on this element.
 */
const METER_VALUE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'aria-valuenow',
  'aria-valuemin',
  'aria-valuemax',
  'aria-valuetext',
])

/**
 * One `aria-allowed-attr` node, tested against the exact shape of a known **axe-core defect**.
 *
 * ## What axe reports, and why it is wrong
 *
 * axe 4.13.0 raises `aria-allowed-attr` at `critical` on the credit meter on `/accounts`, saying
 * `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and `aria-valuetext` are "not allowed". All
 * four are allowed on `role="meter"`. The cause is in axe's own source: `ariaAllowedAttrEvaluate`
 * calls `getRole(virtualNode)` **without** `{ fallback: true }`, and `getExplicitRole` then does
 *
 * ```js
 * const roleList = fallback ? tokenList(roleAttr) : [roleAttr]
 * ```
 *
 * — so the whole string `"meter progressbar"` is looked up as if it were a single role name, no
 * definition matches, and the element resolves to *no role at all*. A role-less `<div>` is allowed
 * only the global attributes, so every value attribute on it is flagged. axe has the token-list
 * splitter; this check simply does not ask for it. Confirmed against a minimal fixture: axe 4.13.0
 * flags both `role="meter progressbar"` and `role="progressbar meter"` and does **not** flag
 * `role="meter"` — the order of the tokens makes no difference, which is the signature of a
 * resolution failure rather than a judgement about `meter`.
 *
 * ## What a reader actually gets
 *
 * Chrome's own accessibility tree, dumped over CDP on this page, computes the node as
 * `role: "meter"`, `name: "zł 1,692.11 of zł 10,000.00 used, 17%"`, `value: 0.169…`, with
 * `valuemin: 0` and `valuemax: 1` — identical to the tree it computes for a hand-written
 * `role="meter"` with the same attributes. WebKit resolves the same list to `meter` too. The
 * markup is correct, the announcement is correct, and the finding is a false positive.
 *
 * ## Why this is a correction and not a waiver
 *
 * The rule stays **on**, for this page and every node on it. A node is dropped only when all three
 * hold: the rule is `aria-allowed-attr`; the live element's `role` attribute is exactly the React
 * Aria fallback list; and every attribute axe flagged is one of the four ARIA allows on `meter`. A
 * fifth attribute, a different element, a different rule or a changed role string all fail the
 * build as before — and `the credit meter announces as a meter` below asserts, positively, the
 * behaviour this correction claims is true.
 *
 * **Re-check on or before 2027-03-01**, or at the next axe-core upgrade, whichever is first: if
 * `getRole` in `aria-allowed-attr-evaluate` has gained `{ fallback: true }`, delete this helper and
 * its two call sites. Tracking: dequelabs/axe-core#3768 "Support fallback roles", open, milestoned
 * for axe-core 5.0 with no date, and reported there against this very component — "We noticed this
 * on the Adobe React Spectrum meter component". axe-core 4.11 taught `aria-prohibited-attr` to
 * split the list (#4325) and deliberately stopped there, so `aria-allowed-attr` is not fixed by a
 * patch upgrade and this must be re-read rather than assumed.
 */
async function isMeterFallbackRoleArtefact(
  page: Page,
  node: NodeResult,
): Promise<boolean> {
  // A single CSS selector is the only target shape this forgives. An iframe or shadow-DOM target
  // arrives as a nested array, and that is a node this correction has never been reasoned about.
  const [selector] = node.target
  if (node.target.length !== 1 || typeof selector !== 'string') {
    return false
  }

  // The live element, not axe's truncated `html` snippet: the snippet elides long attribute
  // values with an ellipsis and would happily match a role string that only starts the same way.
  const role = await page.evaluate(
    (css) => document.querySelector(css)?.getAttribute('role') ?? null,
    selector,
  )
  if (role !== RAC_METER_FALLBACK_ROLE) {
    return false
  }

  const check = node.all.find((entry) => entry.id === 'aria-allowed-attr')
  const flagged: unknown = check?.data
  if (!Array.isArray(flagged) || flagged.length === 0) {
    return false
  }

  // `data` is a list of `attr="value"` strings; only the name decides.
  return flagged.every((entry) =>
    METER_VALUE_ATTRIBUTES.has(String(entry).split('=')[0]),
  )
}

/** Every violation, less the nodes that are the axe defect above. */
export async function withoutKnownAxeDefects(
  page: Page,
  violations: readonly Violation[],
): Promise<Violation[]> {
  const kept: Violation[] = []

  for (const violation of violations) {
    if (violation.id !== 'aria-allowed-attr') {
      kept.push(violation)
      continue
    }

    const nodes: NodeResult[] = []
    for (const node of violation.nodes) {
      if (!(await isMeterFallbackRoleArtefact(page, node))) {
        nodes.push(node)
      }
    }
    // A violation whose every node was the defect disappears; one that kept a node still fails,
    // and still names the nodes it kept.
    if (nodes.length > 0) {
      kept.push({ ...violation, nodes })
    }
  }

  return kept
}
