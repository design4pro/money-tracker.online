/**
 * `decide` is the whole script: everything around it is a GitHub read and a GitHub write. It is
 * exported and tested directly rather than driven over fixtures like its two neighbours, because
 * what can go wrong here is not an exit code but a judgement - arming a run nobody wanted, or
 * failing to arm one that would have cleared a red PR.
 *
 * The three cases worth naming: a pull request that is not targeting the integration branch is
 * not this automation's business at all; a declined thread stays open by design, so the marker
 * keeps a PR from being armed twice for the same head; and a human's thread is not the
 * automation's business either, because a disagreement is settled by talking, not by a run.
 */

import { describe, expect, it } from 'vitest'

import { decide, LABEL, readReviewState } from '../review-threads-label.mjs'

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
  baseRef: 'develop',
  integrationBranch: 'develop',
  headSha: HEAD,
  markerSha: null,
  ...over,
})

describe('decide', () => {
  /**
   * The standing promotion of the integration branch into the default branch is the pull request
   * this automation must never touch: its *head* is the integration branch, so the run it would
   * start would merge the default branch into it and push follow-up commits straight onto it.
   * The base branch is what tells that pull request apart; the two rows after this one are the
   * regression a label-based stand-down would have introduced.
   */
  it('stands down on a pull request that is not targeting the integration branch', () => {
    const { act, reason } = decide(
      input({
        baseRef: 'main',
        integrationBranch: 'develop',
        labels: ['merge-queue'],
      }),
    )
    expect(act).toBe('skip')
    expect(reason).toContain('main')
    expect(reason).toContain('develop')
  })

  // `merge-queue` is what the promotion carries, and adding it to HOLDS would have been the
  // obvious symmetry with the "Autopilot new pull requests" stand-down. It is also exactly what this automation
  // is for: approved, waiting to merge, and held by an open thread. Pinned so the naive fix
  // cannot come back.
  it('arms an approved pull request carrying merge-queue', () => {
    expect(decide(input({ labels: ['merge-queue'] })).act).toBe('label')
  })

  // Routing is asked before the holds, so the job log says "not this automation's pull request"
  // rather than "held" - two different things for whoever is reading it.
  it('reports the base branch rather than the hold when both apply', () => {
    const { act, reason } = decide(
      input({
        baseRef: 'main',
        integrationBranch: 'develop',
        labels: ['in-progress'],
      }),
    )
    expect(act).toBe('skip')
    expect(reason).toContain('main')
    expect(reason).not.toContain('in-progress')
  })

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

  // The hold above is why nothing was ever armed. "Autopilot new pull requests" fires on `pull_request.opened`
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

/**
 * `decide` is only ever as good as the read that feeds it. One page is 100 review threads, and a
 * pull request that has been through several review rounds has more - so a read that stops at the
 * first page hands `decide` a set with nothing open in it and gets back the same "nothing open" a
 * genuinely clean pull request produces. That is the failure this walk exists to prevent, and the
 * second case below is it: the same fixture, read one page deep, calling a red pull request clean.
 *
 * The page fetcher is injected for the reason `decide` is exported - the walk becomes a table of
 * pages rather than something that only happens against GitHub.
 */

const rawThread = (over = {}) => ({
  isResolved: false,
  isOutdated: false,
  comments: { nodes: [{ author: { login: 'claude' } }] },
  ...over,
})

/** A full page of threads somebody already settled - the shape that hides the live ones. */
const settled = (count) =>
  Array.from({ length: count }, () => rawThread({ isResolved: true }))

/** One `reviewThreads` page as GitHub returns it. `endCursor` null means this is the last one. */
const page = (
  threads,
  { endCursor = null, labels = [], baseRef = 'develop' } = {},
) => ({
  baseRefName: baseRef,
  labels: { nodes: labels.map((name) => ({ name })) },
  reviewThreads: {
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
    nodes: threads,
  },
})

describe('readReviewState', () => {
  it('walks to the page the live threads are on, and arms on what it finds', () => {
    const pages = [page(settled(100), { endCursor: 'page-2' }), page([rawThread()])]
    const asked = []

    const state = readReviewState((cursor) => {
      asked.push(cursor)
      return pages[asked.length - 1]
    })

    expect(asked).toEqual([null, 'page-2'])
    expect(state.threads).toHaveLength(101)
    expect(decide(input(state)).act).toBe('label')
  })

  it('would have called that same pull request clean off its first page alone', () => {
    const firstPageOnly = readReviewState(() => page(settled(100)))

    expect(decide(input(firstPageOnly)).act).toBe('skip')
  })

  it('carries the labels through, which is one of the other inputs decide reads', () => {
    const state = readReviewState(() => page([rawThread()], { labels: ['in-progress'] }))

    expect(state.labels).toEqual(['in-progress'])
    expect(decide(input(state)).reason).toContain('in-progress')
  })

  // The read is the only place the base branch can come from, and `input` spreads the state over
  // its own `integrationBranch: 'develop'` - so this is the whole path from a GitHub page to the
  // stand-down, not just the field being present.
  it('carries the base branch through, which is what routes the decision', () => {
    const state = readReviewState(() => page([rawThread()], { baseRef: 'main' }))

    expect(state.baseRef).toBe('main')
    expect(decide(input(state)).act).toBe('skip')
  })
})
