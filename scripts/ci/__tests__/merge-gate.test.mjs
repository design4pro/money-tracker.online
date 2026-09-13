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
