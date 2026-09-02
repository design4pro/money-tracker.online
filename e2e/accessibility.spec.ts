import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { gotoApp, useLocale, useTheme } from './support/app'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Browser, BrowserContext, Page } from '@playwright/test'

/**
 * Axe's own result shapes, read off the builder rather than imported from `axe-core`.
 *
 * `axe-core` is a transitive dependency here — `@axe-core/playwright` depends on it, nothing in
 * this repository declares it — so importing its types directly resolves under a hoisting node
 * layout and fails under pnpm's. Deriving them from the method that returns them cannot drift.
 */
type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>
type Violation = AxeResults['violations'][number]

/**
 * `@axe-core/playwright` over the four screens a reader cannot avoid, in both themes and both
 * locales.
 *
 * ## Why the matrix has these two axes
 *
 * Theme and locale are the two dimensions that change the rendered document rather than the
 * viewport. A dark theme is a different set of colour tokens, so contrast is a *different
 * question* in each — and contrast is the violation this product is most exposed to, since
 * `DESIGN.md` builds both palettes from one token layer and a single mis-mapped token is invisible
 * in the theme it was authored in. A locale changes `<html lang>`, the length of every label, and
 * the accessible name of every control, so a name that was correct in English can be missing in
 * Polish. Scanning one theme in one language is scanning a quarter of the product.
 *
 * Width is deliberately *not* a third axis here: `playwright.config.ts` owns the viewports and
 * already runs this file at a phone width under `mobile-safari`. Multiplying it here would run the
 * same scans twice under two different owners.
 *
 * ## What counts as a failure
 *
 * Any violation carrying a WCAG 2.0/2.1/2.2 **A or AA** tag, at any impact. That is stricter than
 * `docs/ACCESSIBILITY.md` §5.1, which fails the build only at `serious` and above — a deliberate
 * choice for a regression net: a `minor` A-level violation is still a failed success criterion, and
 * the point of this file is to hold the line rather than to triage it.
 *
 * Axe's `best-practice` rules are *excluded*, because they are not WCAG. Including them would make
 * this spec fail for reasons the conformance claim in `docs/ACCESSIBILITY.md` §1 does not make, and
 * the first person to hit one would widen the exclusion list rather than fix a real violation.
 *
 * And what this spec proves is narrow, which §5.1 states out loud: axe reaches roughly a third of
 * WCAG by criterion count. It is a floor. Keyboard traversal, focus order and the sensible landing
 * of focus after a save live in `keyboard.spec.ts`; the rest is the manual list in §5.3.
 */

/** The A and AA tags of every WCAG version this product claims. No `best-practice`. */
const WCAG_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
] as const

interface Surface {
  readonly name: string
  readonly path: string
  /** `undefined` = the signed-out visitor, which is the only way to see `/login`. */
  readonly session: 'demo' | undefined
}

/**
 * The screens a reader cannot avoid: the four named in the brief, plus the three that wave 3 added.
 *
 * They are read with the seeded demo session, never written to, so `scripts/seed/verify.mjs` still
 * finds every counter it asserts. Reading the *demo* workspace also matters for what axe sees:
 * `/transactions` there is a populated grid and `/dashboard` a populated set of cards, so the scan
 * covers rendered rows, badges and figures rather than seven empty-state illustrations.
 *
 * `/budgets`, `/recurring` and `/goals` are here rather than only in their own per-route specs
 * because those specs assert the plans' narrower bar — zero `serious`, zero `critical`, one theme,
 * one locale. This file's bar is every WCAG A/AA violation at any impact, in **both** themes and
 * **both** locales, and the three new surfaces carry exactly the things that axis catches: a
 * hand-written `role="meter"` whose accessible value is a sentence, a status word that must survive
 * translation, and a hue per verdict in two palettes. Their detail routes are not listed: an id in
 * the path makes the surface a seeded row rather than a route, and the per-route visual specs
 * already scan those with the same rule set.
 */
/** Named, because the meter case at the foot of this file opens this same surface. */
const ACCOUNTS: Surface = {
  name: 'accounts',
  path: '/accounts',
  session: 'demo',
}

const SURFACES: readonly Surface[] = [
  { name: 'sign in', path: '/login', session: undefined },
  { name: 'dashboard', path: '/dashboard', session: 'demo' },
  ACCOUNTS,
  { name: 'transactions', path: '/transactions', session: 'demo' },
  { name: 'budgets', path: '/budgets', session: 'demo' },
  { name: 'recurring', path: '/recurring', session: 'demo' },
  { name: 'savings goals', path: '/goals', session: 'demo' },
]

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

/* -------------------------------------------------------------------------- */
/* The one axe defect this file corrects — and nothing else                     */
/* -------------------------------------------------------------------------- */

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
const RAC_METER_FALLBACK_ROLE = 'meter progressbar'

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
async function withoutKnownAxeDefects(
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

/**
 * One violation, written out so the failure names the element and the criterion.
 *
 * A bare rule id sends the next reader to the axe documentation to find out which of forty nodes
 * on the page it meant; the selector and the failure summary let them open the screen and see it.
 */
function describeViolation(violation: Violation): string {
  const nodes = violation.nodes
    .slice(0, 4)
    .map((node) => {
      const target = node.target.join(' ')
      const why = node.failureSummary?.replace(/\s+/g, ' ').trim() ?? ''
      return `    - ${target}\n      ${why}`
    })
    .join('\n')

  const more =
    violation.nodes.length > 4
      ? `\n    …and ${violation.nodes.length - 4} more node(s)`
      : ''

  return (
    `  [${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}\n` +
    `  ${violation.helpUrl}\n${nodes}${more}`
  )
}

function report(violations: readonly Violation[], label: string): string {
  return (
    `${violations.length} WCAG A/AA violation(s) on ${label}:\n` +
    violations.map(describeViolation).join('\n')
  )
}

/**
 * A context and a hydrated page for one surface, in one theme and one locale.
 *
 * The caller owns the context and must close it — which is why this answers both.
 */
async function openSurface(
  browser: Browser,
  surface: Surface,
  theme: AppTheme,
  locale: AppLocale,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(
    surface.session === undefined
      ? { storageState: { cookies: [], origins: [] } }
      : { storageState: storageStateFor(surface.session) },
  )

  // Both before the first navigation: the locale is negotiated on the server from this cookie,
  // and the theme is applied by the pre-paint bootstrap script. Applied afterwards, each would
  // scan a document that corrected itself after axe had already read it.
  await useLocale(context, locale)
  const page = await context.newPage()
  await useTheme(page, theme)

  await gotoApp(page, surface.path)
  // Axe reads the accessibility tree, which is only final once React has attached its handlers
  // and its `aria-*` state — `gotoApp` waits for that. `main` being visible is the extra claim
  // that the route resolved rather than landing on an error boundary that would scan clean.
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', locale)

  return { context, page }
}

async function scan(
  browser: Browser,
  surface: Surface,
  theme: AppTheme,
  locale: AppLocale,
): Promise<void> {
  const { context, page } = await openSurface(browser, surface, theme, locale)

  try {
    const results = await new AxeBuilder({ page })
      .withTags([...WCAG_AA_TAGS])
      .analyze()

    const violations = await withoutKnownAxeDefects(page, results.violations)

    // The assertion compares a short list of `impact · rule` lines rather than the raw violation
    // objects: a `toEqual` diff of axe's own structures buries the rule id under several screens
    // of `relatedNodes: []`, and the reader needs the rule and the selector, which the message
    // carries in full.
    const summary = violations.map(
      (violation) => `${violation.impact ?? 'unknown'} · ${violation.id}`,
    )
    expect(
      summary,
      report(violations, `${surface.name} · ${theme} · ${locale}`),
    ).toEqual([])
  } finally {
    await context.close()
  }
}

test.describe('accessibility', () => {
  for (const surface of SURFACES) {
    for (const theme of THEMES) {
      for (const locale of LOCALES) {
        test(`${surface.name} has no WCAG A or AA violations · ${theme} · ${locale}`, async ({
          browser,
        }) => {
          await scan(browser, surface, theme, locale)
        })
      }
    }
  }

  /**
   * The positive half of the correction in `isMeterFallbackRoleArtefact`.
   *
   * Dropping an axe node earns nothing unless the behaviour it was pointing at is asserted
   * somewhere. So this holds the three facts the correction rests on, and holds them harder than
   * the rule it replaces: the fallback list is present, it resolves to **`meter`** rather than
   * decaying to `progressbar` or to nothing, and the value attributes it carries produce the
   * whole sentence as the accessible name — "zł 1,692.11 of zł 10,000.00 used, 17%", not "17%".
   *
   * On Chromium it goes further and reads the browser's *own* accessibility tree over CDP, which
   * is what a screen reader consumes; on WebKit, where no such protocol is reachable from here,
   * Playwright's ARIA resolver is the available answer and it agrees.
   *
   * If React Aria ever stops emitting the list, or a browser stops resolving it, this fails —
   * which is the signal to delete the correction rather than to widen it.
   */
  test('the credit meter on accounts announces as a meter, with its whole sentence as the name', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await openSurface(
      browser,
      ACCOUNTS,
      'light',
      'en',
    )

    try {
      const fallbackNodes = page.locator(`[role="${RAC_METER_FALLBACK_ROLE}"]`)
      const fallbackCount = await fallbackNodes.count()
      expect(
        fallbackCount,
        'the seeded demo workspace has at least one credit account with a limit',
      ).toBeGreaterThan(0)

      // Every one of them resolves to `meter`, and none of them to `progressbar`: the second
      // token is the fallback for an agent that lacks the first, and no browser we ship to needs
      // it any more. `toHaveCount` on both is what makes that a claim rather than an assumption.
      await expect(page.getByRole('meter')).toHaveCount(fallbackCount)
      await expect(page.getByRole('progressbar')).toHaveCount(0)

      const meter = page.getByRole('meter').first()
      await expect(meter).toHaveAccessibleName(/ of .* used, \d+%$/)
      await expect(meter).toHaveAttribute('aria-valuenow', /^[\d.]+$/)
      await expect(meter).toHaveAttribute('aria-valuemin', '0')
      await expect(meter).toHaveAttribute('aria-valuemax', '1')

      if (testInfo.project.name === 'chromium') {
        const cdp = await context.newCDPSession(page)
        try {
          await cdp.send('Accessibility.enable')
          const { nodes } = await cdp.send('Accessibility.getFullAXTree')
          const meters = nodes.filter(
            (axNode) => axNode.role?.value === 'meter',
          )
          expect(
            meters.length,
            "Chrome's own accessibility tree computes the fallback list as role=meter",
          ).toBe(fallbackCount)
          expect(meters[0]?.name?.value).toMatch(/ of .* used, \d+%$/)
        } finally {
          await cdp.detach()
        }
      }
    } finally {
      await context.close()
    }
  })
})
