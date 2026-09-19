import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * One rule, asserted in every place the review workflows have to follow it: nothing the branch under
 * review supplies may judge that branch or run with a write token.
 *
 * The workflows stated the rule twice in prose - at the hooks re-checkout and at
 * `rearm-review-threads` - and #103 found the third instance unguarded: `claude-review` checks out
 * the pull request's own merge commit and then runs `scripts/ci/review-threads-label.mjs` from it,
 * on `github.token`, under `pull-requests: write`. Prose does not hold a rule that three separate
 * steps have to remember; this file does. It asserts the shape - a base-branch re-checkout whose
 * pathspec covers every tree those steps read, ahead of every `scripts/ci` invocation - and not any
 * particular wording, because the wording is the part that is meant to keep changing.
 *
 * @see .github/workflows/claude-code-review.yml
 * @see .github/workflows/rearm-review-threads.yml
 * @see https://github.com/design4pro/money-tracker.online/issues/103
 */
const root = resolve(__dirname, '../../..')

const WORKFLOW = '.github/workflows/claude-code-review.yml'
const REARM_WORKFLOW = '.github/workflows/rearm-review-threads.yml'

const workflow = readFileSync(resolve(root, WORKFLOW), 'utf8')
const rearmWorkflow = readFileSync(resolve(root, REARM_WORKFLOW), 'utf8')

/** The `types:` list under `on.pull_request`, as written on its one line. */
const pullRequestTypes = (source: string): string[] => {
  const match = source.match(/\n {2}pull_request:\n(?: {4}#[^\n]*\n)* {4}types: \[([^\]]*)\]/)
  expect(match, 'no pull_request.types list').not.toBeNull()
  return match![1].split(',').map((type) => type.trim())
}

/** The `claude-review` job: from its own key to the end of the file, the only job in it. */
const reviewJob = workflow.slice(workflow.indexOf('\n  claude-review:'))

describe(WORKFLOW, () => {
  // The slice above is taken by `indexOf`, and `indexOf` answers -1 rather than throwing: a renamed
  // job would quietly turn `reviewJob` into the last character of the file, and every
  // `not.toMatch` in here would still pass. This is what makes the negative assertions mean
  // something.
  it('holds the claude-review job and no other', () => {
    expect(reviewJob.length).toBeGreaterThan(1)
    const jobs = workflow.slice(workflow.indexOf('\njobs:\n'))
    expect(jobs.match(/^ {2}[\w-]+:$/gm)).toEqual(['  claude-review:'])
  })

  // `claude-review` is a required check, and a job its own `if` skips reports success. A label
  // event here therefore produced a second, always-green `claude-review` check run on a head whose
  // real review had ended red (#300). A label change must not start this workflow at all.
  it('starts on no label event', () => {
    expect(pullRequestTypes(workflow)).not.toContain('labeled')
    expect(pullRequestTypes(workflow)).not.toContain('unlabeled')
  })

  describe('claude-review', () => {
    // The pathspec, not the step's name: renaming the step is fine, dropping a path from it is not.
    it('re-checks out the hooks, their settings and the CI scripts from the base branch', () => {
      expect(reviewJob).toMatch(/git checkout FETCH_HEAD -- [^\n]*\.claude\/settings\.json/)
      expect(reviewJob).toMatch(/git checkout FETCH_HEAD -- [^\n]*\.claude\/hooks/)
      expect(reviewJob).toMatch(/git checkout FETCH_HEAD -- [^\n]*scripts\/ci/)
    })

    // A script is only as trustworthy as what it reads. review-threads-label.mjs takes its scope -
    // which pull requests this automation is for at all - from `baseBranch` in this file, so a
    // pull request supplying its own copy would be deciding whether it may arm a run on itself.
    it('re-checks out the om config the arming script reads its scope from', () => {
      expect(reviewJob).toMatch(
        /git checkout FETCH_HEAD -- [^\n]*\.ai\/agentic\.config\.json/,
      )
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

  describe(REARM_WORKFLOW, () => {
    // Its own file, so that the `unlabeled` it needs never starts claude-code-review.yml (#300).
    it('starts only when a label comes off, and only for in-progress', () => {
      expect(pullRequestTypes(rearmWorkflow)).toEqual(['unlabeled'])
      expect(rearmWorkflow).toMatch(
        /if: github\.event\.action == 'unlabeled' && github\.event\.label\.name == 'in-progress'/,
      )
    })

    it('checks out the base branch rather than the pull request', () => {
      expect(rearmWorkflow).toMatch(/ref: \$\{\{ github\.event\.pull_request\.base\.ref \}\}/)
    })

    it('runs the arming script', () => {
      expect(rearmWorkflow).toContain('node scripts/ci/review-threads-label.mjs')
    })
  })

  // The permission #103 asked not to be widened as part of its own fix.
  it('keeps both workflows off contents: write', () => {
    expect(reviewJob).toContain('contents: read')
    expect(rearmWorkflow).toContain('contents: read')
    expect(workflow.match(/contents: write/g)).toBeNull()
    expect(rearmWorkflow.match(/contents: write/g)).toBeNull()
  })
})
