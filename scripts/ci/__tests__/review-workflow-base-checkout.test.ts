import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * One rule, asserted in every place the review workflow has to follow it: nothing the branch under
 * review supplies may judge that branch or run with a write token.
 *
 * The workflow stated the rule twice in prose - at the hooks re-checkout and at
 * `rearm-review-threads` - and #103 found the third instance unguarded: `claude-review` checks out
 * the pull request's own merge commit and then runs `scripts/ci/review-threads-label.mjs` from it,
 * on `github.token`, under `pull-requests: write`. Prose does not hold a rule that three separate
 * steps have to remember; this file does. It asserts the shape - a base-branch re-checkout whose
 * pathspec covers every tree those steps read, ahead of every `scripts/ci` invocation - and not any
 * particular wording, because the wording is the part that is meant to keep changing.
 *
 * @see .github/workflows/claude-code-review.yml
 * @see https://github.com/design4pro/money-tracker.online/issues/103
 */
const root = resolve(__dirname, '../../..')

const WORKFLOW = '.github/workflows/claude-code-review.yml'

const workflow = readFileSync(resolve(root, WORKFLOW), 'utf8')

/** The `claude-review` job: from its own key to the next top-level job key. */
const reviewJob = workflow.slice(
  workflow.indexOf('\n  claude-review:'),
  workflow.indexOf('\n  rearm-review-threads:'),
)

describe(WORKFLOW, () => {
  // Both slices below are taken by `indexOf`, and `indexOf` answers -1 rather than throwing: a
  // renamed job would quietly turn `reviewJob` into a prefix of the file, or into the whole of it,
  // and every `not.toMatch` in here would still pass. This is what makes the negative assertions
  // mean something.
  it('splits into the two jobs this file reasons about', () => {
    expect(reviewJob).not.toBe('')
    expect(workflow).toContain('\n  rearm-review-threads:')
  })

  describe('claude-review', () => {
    // The pathspec, not the step's name: renaming the step is fine, dropping a path from it is not.
    it('re-checks out the hooks, their settings and the CI scripts from the base branch', () => {
      expect(reviewJob).toMatch(/git checkout FETCH_HEAD -- [^\n]*\.claude\/settings\.json/)
      expect(reviewJob).toMatch(/git checkout FETCH_HEAD -- [^\n]*\.claude\/hooks/)
      expect(reviewJob).toMatch(/git checkout FETCH_HEAD -- [^\n]*scripts\/ci/)
    })

    // Green the day it was written, and that is the point: it is the half of #103 that was not
    // broken, held so it cannot become the next report. A step added above the re-checkout would
    // run the pull request's own copy of the script, which is what #103 reported about the
    // pathspec.
    it('runs no scripts/ci script before that re-checkout', () => {
      const reCheckout = reviewJob.indexOf('git checkout FETCH_HEAD --')
      expect(reCheckout).toBeGreaterThan(-1)

      const invocations = [...reviewJob.matchAll(/node scripts\/ci\/[\w-]+\.mjs/g)]
      expect(invocations.length).toBeGreaterThan(0)

      for (const invocation of invocations) {
        expect(
          invocation.index,
          `${invocation[0]} runs before the base-branch re-checkout`,
        ).toBeGreaterThan(reCheckout)
      }
    })

    // The re-checkout is only worth anything while the checkout it corrects is the PR's merge
    // commit. Were the job to check the base ref out wholesale, the guard would move, not vanish -
    // so this asserts the premise the two assertions above rest on.
    it('checks the pull request out, which is why the re-checkout is needed', () => {
      expect(reviewJob).toMatch(/uses: actions\/checkout@v\d+/)
      expect(reviewJob).not.toMatch(/ref: \$\{\{ github\.event\.pull_request\.base\.ref \}\}/)
    })
  })

  describe('rearm-review-threads', () => {
    const rearmJob = workflow.slice(workflow.indexOf('\n  rearm-review-threads:'))

    it('checks out the base branch rather than the pull request', () => {
      expect(rearmJob).toMatch(/ref: \$\{\{ github\.event\.pull_request\.base\.ref \}\}/)
    })
  })

  // The permission #103 asked not to be widened as part of its own fix.
  it('keeps both jobs off contents: write', () => {
    expect(reviewJob).toContain('contents: read')
    expect(workflow.match(/contents: write/g)).toBeNull()
  })
})
