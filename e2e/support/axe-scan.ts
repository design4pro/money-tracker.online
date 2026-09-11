import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

import { withoutKnownAxeDefects } from './axe-defects'

import type { Violation } from './axe-defects'
import type { Page } from '@playwright/test'

/**
 * One page, scanned at the WCAG A/AA bar, with the failure written for a human.
 *
 * Extracted from `accessibility.spec.ts` when `states.spec.ts` needed the same scan over the empty
 * screens. Two copies of a tag list and a violation formatter would drift on the first edit, and
 * the thing that would drift is the definition of what counts as a failure — which is the one part
 * of an accessibility gate that must not have two answers (`docs/SPEC.md` §8: one concept, one
 * owner).
 */

/** The A and AA tags of every WCAG version this product claims. No `best-practice`. */
export const WCAG_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
] as const

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
 * Fail the test if `page` carries any WCAG A/AA violation, at any impact.
 *
 * Stricter than `docs/ACCESSIBILITY.md` §5.1, which fails the build only at `serious` and above —
 * a deliberate choice for a regression net: a `minor` A-level violation is still a failed success
 * criterion, and the point is to hold the line rather than to triage it.
 *
 * `label` names the scan in the failure — the surface, the theme and the locale — because a bare
 * rule id with no context is a failure nobody can reproduce.
 */
export async function expectNoWcagViolations(
  page: Page,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG_AA_TAGS])
    .analyze()

  const violations = await withoutKnownAxeDefects(page, results.violations)

  // The assertion compares a short list of `impact · rule` lines rather than the raw violation
  // objects: a `toEqual` diff of axe's own structures buries the rule id under several screens of
  // `relatedNodes: []`, and the reader needs the rule and the selector, which the message carries
  // in full.
  const summary = violations.map(
    (violation) => `${violation.impact ?? 'unknown'} · ${violation.id}`,
  )
  expect(summary, report(violations, label)).toEqual([])
}
