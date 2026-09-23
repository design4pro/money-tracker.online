/**
 * `decide` is the whole script: everything around it is one env read and one exit code. It is
 * exported and tested directly, the same arrangement as `review-threads-label.test.mjs` next to it
 * and for the same reason - what can go wrong is a judgement, not a crash.
 *
 * The judgement is one a human has already made by clicking a label, so the table below is just
 * `SDLC.md`'s merge rules read back: three labels that block alone, and one that blocks until its
 * approval arrives. The case that matters most is the last one - a pull request carrying labels
 * this file has never heard of must still go green, because a gate that fails closed on an
 * unknown label would block every pull request the taxonomy ever grows.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { decide, HARD_BLOCKS, NEEDS_QA, QA_APPROVED } from '../merge-gate.mjs'

describe('decide', () => {
  it.each(HARD_BLOCKS)('blocks on %s alone, and names it', (label) => {
    const { ok, reason } = decide([label])
    expect(ok).toBe(false)
    expect(reason).toContain(label)
  })

  it('names every hard block the pull request carries, not just the first', () => {
    const { ok, reason } = decide(HARD_BLOCKS)
    expect(ok).toBe(false)
    for (const label of HARD_BLOCKS) expect(reason).toContain(label)
  })

  it('blocks on a hard block even when QA has signed off', () => {
    expect(decide(['do-not-merge', QA_APPROVED, 'merge-queue']).ok).toBe(false)
  })

  it(`blocks on ${NEEDS_QA} until ${QA_APPROVED} arrives`, () => {
    const { ok, reason } = decide([NEEDS_QA])
    expect(ok).toBe(false)
    expect(reason).toContain(NEEDS_QA)
    expect(reason).toContain(QA_APPROVED)
  })

  it(`passes once ${NEEDS_QA} is answered by ${QA_APPROVED}`, () => {
    expect(decide([NEEDS_QA, QA_APPROVED]).ok).toBe(true)
  })

  it(`passes on ${QA_APPROVED} alone, which is not a request for anything`, () => {
    expect(decide([QA_APPROVED]).ok).toBe(true)
  })

  it('passes an unlabelled pull request', () => {
    expect(decide([]).ok).toBe(true)
  })

  it('passes labels it has no opinion about', () => {
    expect(
      decide(['feature', 'risk-low', 'review', 'skip-qa', 'priority-high']).ok,
    ).toBe(true)
  })
})

/**
 * The workflow around `decide`, asserted here because both properties below are ones a later edit
 * could plausibly "simplify" away, and neither failure would look like a failure.
 *
 * The checkout is the security half: the branch under review must not supply the script that
 * judges it. The existence test is the bootstrap half, and it exists only because of the first
 * one - a base branch that has no gate yet cannot express a hard block, so the pull request
 * introducing the gate has nothing to enforce. Dropping the existence test makes every adoption
 * of this check fail once on MODULE_NOT_FOUND; dropping the checkout makes the gate judge itself.
 */
describe('.github/workflows/merge-gate.yml', () => {
  // A URL relative to this module, not `__dirname`: this file is ESM, where that global does not
  // exist, and the sibling that uses it is TypeScript, which vitest transforms.
  const workflow = readFileSync(
    new URL('../../../.github/workflows/merge-gate.yml', import.meta.url),
    'utf8',
  )

  it('runs metadata policy from the trusted default branch', () => {
    expect(workflow).toContain('pull_request_target:')
    expect(workflow).toMatch(/ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/)
    expect(workflow).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/)
  })

  it('reads fresh pull request metadata instead of the triggering event snapshot', () => {
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}')
    expect(workflow).toContain('PR_NUMBER: ${{ github.event.pull_request.number || github.event.issue.number }}')
    expect(workflow).toContain('PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}')
    expect(workflow).toContain('checks: write')
    expect(workflow).not.toContain('toJSON(github.event.pull_request.labels')
    expect(workflow).toContain('issue_comment:')
    expect(workflow).toContain('pull_request_review:')
  })

  it('publishes the trusted decision on the PR head commit', () => {
    const script = readFileSync(new URL('../merge-gate.mjs', import.meta.url), 'utf8')
    expect(script).toContain('repos/${repo}/check-runs')
    expect(script).toContain("name: 'merge-gate'")
    expect(script).toContain('head_sha: headSha')
  })

  it('fails closed when the trusted policy script is missing', () => {
    expect(workflow).not.toMatch(/if \[ ! -f scripts\/ci\/merge-gate\.mjs \]/)
  })

})
