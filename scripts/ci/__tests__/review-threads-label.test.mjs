/**
 * `decide` is the whole script: everything around it is a GitHub read and a GitHub write. It is
 * exported and tested directly rather than driven over fixtures like its two neighbours, because
 * what can go wrong here is not an exit code but a judgement - arming a run nobody wanted, or
 * failing to arm one that would have cleared a red PR.
 *
 * The two cases worth naming: a declined thread stays open by design, so the marker keeps a PR
 * from being armed twice for the same head; and a human's thread is not the automation's business,
 * because a disagreement is settled by talking, not by a run.
 */

import { describe, expect, it } from 'vitest'

import { decide, LABEL } from '../review-threads-label.mjs'

const HEAD = 'abc1234def5678'

const botThread = (over = {}) => ({
  isResolved: false,
  isOutdated: false,
  author: 'claude',
  ...over,
})

const input = (over = {}) => ({
  threads: [botThread()],
  labels: [],
  headSha: HEAD,
  markerSha: null,
  ...over,
})

describe('decide', () => {
  it('arms the automation when the review bot left a live thread', () => {
    const { act, reason } = decide(input())
    expect(act).toBe('label')
    expect(reason).toContain('1 unresolved')
  })

  it('does nothing when every bot thread is resolved', () => {
    expect(
      decide(input({ threads: [botThread({ isResolved: true })] })).act,
    ).toBe('skip')
  })

  it('ignores an outdated thread, which the merge gate no longer holds', () => {
    expect(
      decide(input({ threads: [botThread({ isOutdated: true })] })).act,
    ).toBe('skip')
  })

  it("leaves a human's thread to a human", () => {
    expect(
      decide(input({ threads: [botThread({ author: 'rafalwolak' })] })).act,
    ).toBe('skip')
  })

  it('recognises the bot under each login it posts as', () => {
    for (const author of ['claude', 'claude[bot]', 'github-actions[bot]'])
      expect(decide(input({ threads: [botThread({ author })] })).act).toBe(
        'label',
      )
  })

  it.each(['in-progress', 'blocked', 'do-not-merge'])(
    'stands down while the PR carries %s',
    (label) => {
      const { act, reason } = decide(input({ labels: [label] }))
      expect(act).toBe('skip')
      expect(reason).toContain(label)
    },
  )

  // The hold above is why nothing was ever armed. `pr-autopilot` fires on `pull_request.opened`
  // and claims within a minute; the review job needs five to eight, so its arming step has never
  // once been asked at a moment when `in-progress` was absent - three for three on #320, #321 and
  // #322, and zero `pr-fix` runs in the cockpit's whole history. The claim coming off is the
  // first moment the answer can be anything else, and `pull_request.unlabeled` in
  // claude-code-review.yml is what asks again then. This case is that second ask.
  it('arms once the claim is released, which is what the re-arm job asks', () => {
    expect(decide(input({ labels: ['in-progress'] })).act).toBe('skip')
    expect(decide(input({ labels: ['changes-requested'] })).act).toBe('label')
  })

  // And it asks only once per head, so a run that declines every thread and pushes nothing cannot
  // re-arm itself when it drops its own claim.
  it("does not loop when the released claim was the autofix run's own", () => {
    expect(
      decide(input({ labels: ['changes-requested'], markerSha: HEAD })).act,
    ).toBe('skip')
  })

  it('does not re-apply a label a run has not taken yet', () => {
    expect(decide(input({ labels: [LABEL] })).act).toBe('skip')
  })

  it('refuses to arm the same head twice, so a declined thread cannot loop', () => {
    const { act, reason } = decide(input({ markerSha: HEAD }))
    expect(act).toBe('skip')
    expect(reason).toContain(HEAD.slice(0, 8))
  })

  it('arms again once the head has moved', () => {
    expect(decide(input({ markerSha: 'deadbeefcafe' })).act).toBe('label')
  })

  it('counts only the threads that hold the merge', () => {
    const { reason } = decide(
      input({
        threads: [
          botThread(),
          botThread(),
          botThread({ isResolved: true }),
          botThread({ author: 'rafalwolak' }),
        ],
      }),
    )
    expect(reason).toContain('2 unresolved')
  })
})
