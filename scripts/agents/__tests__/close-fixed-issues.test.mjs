import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import {
  parseCloseLinks,
  planClose,
  reconcilePair,
  parseOptions,
  latestReleaseDate,
} from '../close-fixed-issues.mjs'

const pr = JSON.parse(
  readFileSync(new URL('./fixtures/pr-589.json', import.meta.url), 'utf8'),
)
const issue = { number: 311, state: 'OPEN', labels: [], comments: [] }
const options = {
  baseBranch: 'develop',
  repo: 'design4pro/money-tracker.online',
  currentUser: 'design4pro-agent',
  apply: true,
}

describe('parseCloseLinks', () => {
  it('recognizes each English closing keyword, case-insensitively', () => {
    expect(
      parseCloseLinks({
        body: 'FIX #1 fixes #2 fixed #3 close #4 closes #5 closed #6 resolve #7 resolves #8 resolved #9',
      }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
  it('deduplicates title and body links', () => {
    expect(
      parseCloseLinks({ title: 'Fixes #311', body: 'Closes #311' }),
    ).toEqual([311])
  })
  it.each([
    '    Closes #311',
    '\tCloses #311',
    '>     Closes #311',
    '> \tCloses #311',
    'Refs #311',
    '#311',
    'prefixes #311',
    'éfixes #311',
    '_fixes #311',
    '7fixes #311',
    '`Closes #311`',
    '``Closes #311 ` example``',
    '```md\nCloses #311\n```',
    '~~~\nCloses #311\n~~~',
    '```\nCloses #311',
    'Closes other/repo#311',
    'Closes `example` #311',
    '``x `Closes #311`',
    '> ~~~\n> Closes #311\n> ~~~',
    'Closes\n```\nexample\n```\n#311',
  ])('ignores %s', (body) => {
    expect(parseCloseLinks({ body })).toEqual([])
  })
  it('resumes outside fences and keeps punctuation boundaries', () => {
    expect(
      parseCloseLinks({
        body: '```\nCloses #1\n```\n(Fixes #2)\n`Closes #3`\nResolves\n#4',
      }),
    ).toEqual([2, 4])
  })
})

describe('planClose', () => {
  it('closes the real #589 regression without closingIssuesReferences', () => {
    expect(planClose(pr, issue, options).action).toBe('close')
  })
  it.each([
    'https://github.com/design4pro/money-tracker.online/pull/311',
    'https://github.com/other/repo/issues/311',
  ])('skips non-local issue URLs: %s', (url) => {
    expect(planClose(pr, { ...issue, url }, options).action).toBe('skip')
  })
  it('leaves the implementation issue open after a design-only spec merge', () => {
    expect(
      planClose({ ...pr, headRefName: 'spec/map-style' }, issue, options),
    ).toEqual({
      action: 'skip',
      reason: expect.stringContaining('design-only'),
    })
  })
  it('allows ordinary documentation fixes to close their issue', () => {
    expect(
      planClose(
        { ...pr, headRefName: 'fix/docs', labels: [{ name: 'documentation' }] },
        issue,
        options,
      ).action,
    ).toBe('close')
  })
  it('never closes a bare mention', () => {
    expect(planClose({ ...pr, body: 'Refs #311' }, issue, options).action).toBe(
      'skip',
    )
  })
  it('only comments for another base branch', () => {
    expect(
      planClose({ ...pr, baseRefName: 'main' }, issue, options).action,
    ).toBe('comment')
  })
  it.each(['blocked', 'do-not-close', 'in-progress'])('honors %s', (name) => {
    expect(planClose(pr, { ...issue, labels: [{ name }] }, options)).toEqual({
      action: 'skip',
      reason: expect.stringContaining(name),
    })
  })
  it('skips closed issues and unmerged PRs', () => {
    expect(planClose(pr, { ...issue, state: 'CLOSED' }, options).action).toBe(
      'skip',
    )
    expect(planClose({ ...pr, mergedAt: null }, issue, options).action).toBe(
      'skip',
    )
  })
})

describe('reconcilePair', () => {
  function tracker(over = {}) {
    return {
      getIssue: vi.fn(() => ({ ...issue, ...over })),
      comment: vi.fn(),
      close: vi.fn(),
    }
  }
  it('defaults to a completely read-only dry run', () => {
    const api = tracker()
    reconcilePair(pr, 311, { ...options, apply: false }, api)
    expect(api.comment).not.toHaveBeenCalled()
    expect(api.close).not.toHaveBeenCalled()
  })
  it('posts the linked comment before closing', () => {
    const api = tracker()
    reconcilePair(pr, 311, options, api)
    expect(api.comment).toHaveBeenCalledWith(
      311,
      expect.stringContaining(
        'https://github.com/design4pro/money-tracker.online/pull/589',
      ),
    )
    expect(api.comment.mock.invocationCallOrder[0]).toBeLessThan(
      api.close.mock.invocationCallOrder[0],
    )
  })
  it('retries closing without duplicating an already posted comment', () => {
    const api = tracker()
    reconcilePair(pr, 311, options, api)
    const body = api.comment.mock.calls[0][1]
    const retry = tracker({
      comments: [{ body, author: { login: options.currentUser } }],
    })
    reconcilePair(pr, 311, options, retry)
    expect(retry.comment).not.toHaveBeenCalled()
    expect(retry.close).toHaveBeenCalledOnce()
  })
  it('does not close when posting the comment fails', () => {
    const api = tracker()
    api.comment.mockImplementation(() => {
      throw new Error('offline')
    })
    expect(() => reconcilePair(pr, 311, options, api)).toThrow('offline')
    expect(api.close).not.toHaveBeenCalled()
  })
  it('does not duplicate informational comments on a second pass', () => {
    const other = { ...pr, baseRefName: 'main' }
    const api = tracker()
    reconcilePair(other, 311, options, api)
    const retry = tracker({
      comments: [
        {
          body: api.comment.mock.calls[0][1],
          author: { login: options.currentUser },
        },
      ],
    })
    reconcilePair(other, 311, options, retry)
    expect(retry.comment).not.toHaveBeenCalled()
    expect(retry.close).not.toHaveBeenCalled()
  })
})

describe('parseOptions', () => {
  it('requires explicit apply and lets dry-run override apply', () => {
    expect(parseOptions([]).apply).toBe(false)
    expect(parseOptions(['--apply']).apply).toBe(true)
    expect(parseOptions(['--apply', '--dry-run']).apply).toBe(false)
  })
  it.each([
    ['--limit', '0'],
    ['--limit', '-1'],
    ['--since', 'garbage'],
    ['--unexpected'],
  ])('rejects invalid options %s', (...args) => {
    expect(() => parseOptions(args)).toThrow()
  })
})

describe('latestReleaseDate', () => {
  it('uses the topmost release, even when it is older than seven days', () => {
    expect(
      latestReleaseDate(
        '# Changelog\n\n# 0.2.0 (2026-08-01)\n\n# 0.1.0 (2026-07-01)',
      ),
    ).toBe('2026-08-01')
    expect(parseOptions([]).since).toBe('last-release')
    expect(parseOptions(['--since', '2026-07-01']).since).toBe('2026-07-01')
  })
  it.each([
    '# Changelog',
    '# 0.2.0 (unknown)\n# 0.1.0 (2026-07-01)',
    '# 0.2.0 (2026-02-30)',
  ])('never silently narrows a malformed release window', (text) => {
    expect(() => latestReleaseDate(text)).toThrow('--since')
  })
})
