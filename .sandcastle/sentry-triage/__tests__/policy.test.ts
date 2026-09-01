// The first tests any sandcastle routine has had, and they exist because this one is the first with
// enough policy to be wrong silently. A dedup check that stops matching files a duplicate every
// week; a threshold that inverts floods the backlog. Neither announces itself.

import { describe, expect, it } from 'vitest'

import {
  REGRESSION_GRACE_MS,
  buildTrackedIndex,
  dedupeVerdict,
  filingOrder,
  parseMarkers,
  renderIssueBody,
  renderMarker,
  renderTitle,
  selectionVerdict,
} from '../policy'

import type { Candidate, TrackedIssue } from '../policy'

const NOW = Date.parse('2026-08-29T12:00:00Z')

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    shortId: 'MONEY-TRACKER-4KQ',
    issueUrl: 'https://design4pro.sentry.io/issues/1/',
    title: 'TypeError reading id in listTripsForOrganization',
    errorType: 'TypeError',
    errorValue: "Cannot read properties of undefined (reading 'id')",
    culprit: 'src/server/repos/trips.ts in listTripsForOrganization',
    level: 'error',
    sentryStatus: 'unresolved',
    unhandled: true,
    environments: ['production'],
    primaryEnvironment: 'production',
    firstSeen: '2026-08-21T19:03:44Z',
    lastSeen: '2026-08-29T04:12:08Z',
    eventCount: 214,
    userCount: 31,
    release: 'b41c9ad',
    inAppFrame: {
      file: 'src/server/repos/trips.ts',
      line: 142,
      fn: 'listTripsForOrganization',
    },
    breadcrumbs: ['navigation → /app/trips'],
    suspectedCause:
      'the tenant scope resolves before the organization is attached',
    judgement: 'file',
    judgementReason: 'reaches users as a failed request',
    ...overrides,
  }
}

describe('markers', () => {
  it('round-trips a short id, with and without a regression sequence', () => {
    expect(parseMarkers(renderMarker('MONEY-TRACKER-4KQ', 1))).toEqual([
      { shortId: 'MONEY-TRACKER-4KQ', sequence: 1 },
    ])
    expect(parseMarkers(renderMarker('MONEY-TRACKER-4KQ', 3))).toEqual([
      { shortId: 'MONEY-TRACKER-4KQ', sequence: 3 },
    ])
  })

  it('does not mistake a short id quoted in prose for a filed ticket', () => {
    // A maintainer naming an issue in a comment must not suppress the ticket for it.
    expect(parseMarkers('This looks like MONEY-TRACKER-4KQ to me.')).toEqual([])
    expect(parseMarkers('<!-- sandcastle-triage -->')).toEqual([])
  })

  it('tolerates whitespace and finds every marker in a body', () => {
    const body = `<!--sentry-issue:MONEY-TRACKER-1-->\ntext\n<!--   sentry-issue:  MONEY-TRACKER-2#2   -->`
    expect(parseMarkers(body)).toEqual([
      { shortId: 'MONEY-TRACKER-1', sequence: 1 },
      { shortId: 'MONEY-TRACKER-2', sequence: 2 },
    ])
  })
})

function tracked(...issues: ReadonlyArray<TrackedIssue>) {
  return buildTrackedIndex(issues)
}

function marked(shortId: string, sequence = 1): string {
  return `body\n${renderMarker(shortId, sequence)}`
}

describe('dedupe', () => {
  it('files a short id nothing has seen', () => {
    expect(dedupeVerdict(candidate(), tracked())).toEqual({
      action: 'file',
      sequence: 1,
    })
  })

  it('skips one that already has an open ticket', () => {
    const index = tracked({
      number: 7,
      state: 'OPEN',
      closedAt: null,
      body: marked('MONEY-TRACKER-4KQ'),
    })

    expect(dedupeVerdict(candidate(), index)).toEqual({
      action: 'skip',
      reason: 'already tracked as #7',
    })
  })

  it('prefers the open ticket even when a closed one exists too', () => {
    const index = tracked(
      {
        number: 7,
        state: 'CLOSED',
        closedAt: '2026-08-01T00:00:00Z',
        body: marked('MONEY-TRACKER-4KQ'),
      },
      {
        number: 9,
        state: 'OPEN',
        closedAt: null,
        body: marked('MONEY-TRACKER-4KQ', 2),
      },
    )

    expect(dedupeVerdict(candidate(), index)).toEqual({
      action: 'skip',
      reason: 'already tracked as #9',
    })
  })

  it('skips events that predate the fix', () => {
    const index = tracked({
      number: 7,
      state: 'CLOSED',
      closedAt: '2026-08-29T06:00:00Z',
      body: marked('MONEY-TRACKER-4KQ'),
    })

    expect(
      dedupeVerdict(candidate({ lastSeen: '2026-08-29T05:00:00Z' }), index)
        .action,
    ).toBe('skip')
  })

  it('holds both sides of the deploy grace window', () => {
    const closedAt = '2026-08-20T00:00:00Z'
    const index = tracked({
      number: 7,
      state: 'CLOSED',
      closedAt,
      body: marked('MONEY-TRACKER-4KQ'),
    })
    const justInside = new Date(
      Date.parse(closedAt) + REGRESSION_GRACE_MS,
    ).toISOString()
    const justOutside = new Date(
      Date.parse(closedAt) + REGRESSION_GRACE_MS + 1000,
    ).toISOString()

    expect(
      dedupeVerdict(candidate({ lastSeen: justInside }), index).action,
    ).toBe('skip')
    expect(dedupeVerdict(candidate({ lastSeen: justOutside }), index)).toEqual({
      action: 'file-regression',
      sequence: 2,
      previous: 7,
    })
  })

  it('counts a regression from the highest sequence already filed', () => {
    const index = tracked(
      {
        number: 7,
        state: 'CLOSED',
        closedAt: '2026-08-01T00:00:00Z',
        body: marked('MONEY-TRACKER-4KQ'),
      },
      {
        number: 8,
        state: 'CLOSED',
        closedAt: '2026-08-10T00:00:00Z',
        body: marked('MONEY-TRACKER-4KQ', 2),
      },
    )

    expect(dedupeVerdict(candidate(), index)).toEqual({
      action: 'file-regression',
      sequence: 3,
      previous: 8,
    })
  })

  it('refuses to guess when a timestamp will not parse', () => {
    const index = tracked({
      number: 7,
      state: 'CLOSED',
      closedAt: 'not a date',
      body: marked('MONEY-TRACKER-4KQ'),
    })

    expect(dedupeVerdict(candidate(), index).action).toBe('skip')
  })
})

describe('selection', () => {
  it('accepts a recurring, unhandled production error with a frame of ours', () => {
    expect(selectionVerdict(candidate(), NOW)).toEqual({ ok: true })
  })

  it('respects a maintainer who already resolved or ignored it in Sentry', () => {
    for (const sentryStatus of ['resolved', 'ignored', 'archived'] as const) {
      expect(selectionVerdict(candidate({ sentryStatus }), NOW).ok).toBe(false)
    }
  })

  it('accepts a handled error, which is how every server function fails', () => {
    expect(selectionVerdict(candidate({ unhandled: false }), NOW)).toEqual({
      ok: true,
    })
  })

  it('rejects a warning, and one with no frame in src/', () => {
    expect(selectionVerdict(candidate({ level: 'warning' }), NOW).ok).toBe(
      false,
    )
    expect(selectionVerdict(candidate({ inAppFrame: null }), NOW).ok).toBe(
      false,
    )
  })

  it('rejects a browser-extension frame', () => {
    const frame = {
      file: 'chrome-extension://abc/inject.js',
      line: 1,
      fn: null,
    }
    expect(selectionVerdict(candidate({ inAppFrame: frame }), NOW).ok).toBe(
      false,
    )
  })

  it('rejects known noise by type or message', () => {
    expect(
      selectionVerdict(candidate({ errorType: 'ChunkLoadError' }), NOW).ok,
    ).toBe(false)
    expect(
      selectionVerdict(
        candidate({ errorValue: 'ResizeObserver loop completed' }),
        NOW,
      ).ok,
    ).toBe(false)
  })

  it('rejects one that stopped happening, and one that only ever happened at once', () => {
    expect(
      selectionVerdict(candidate({ lastSeen: '2026-08-20T00:00:00Z' }), NOW).ok,
    ).toBe(false)
    expect(
      selectionVerdict(
        candidate({
          firstSeen: '2026-08-29T04:00:00Z',
          lastSeen: '2026-08-29T04:12:08Z',
        }),
        NOW,
      ).ok,
    ).toBe(false)
  })

  it('lets production through on either count, and staging only on both', () => {
    // Production: one event, but many people.
    expect(
      selectionVerdict(candidate({ eventCount: 1, userCount: 5 }), NOW).ok,
    ).toBe(true)
    // Production: one person, but constantly.
    expect(
      selectionVerdict(candidate({ eventCount: 25, userCount: 1 }), NOW).ok,
    ).toBe(true)

    // Narrowed field by field rather than with a whole-object `as const`: that
    // also freezes `environments` into a `readonly` tuple, which the candidate's
    // mutable array will not take.
    const staging = {
      primaryEnvironment: 'staging' as const,
      environments: ['staging' as const],
    }
    expect(
      selectionVerdict(
        candidate({ ...staging, eventCount: 50, userCount: 1 }),
        NOW,
      ).ok,
    ).toBe(false)
    expect(
      selectionVerdict(
        candidate({ ...staging, eventCount: 49, userCount: 2 }),
        NOW,
      ).ok,
    ).toBe(false)
    expect(
      selectionVerdict(
        candidate({ ...staging, eventCount: 50, userCount: 2 }),
        NOW,
      ).ok,
    ).toBe(true)
  })

  it('holds the production boundary one event under the bar', () => {
    expect(
      selectionVerdict(candidate({ eventCount: 24, userCount: 4 }), NOW).ok,
    ).toBe(false)
    expect(
      selectionVerdict(candidate({ eventCount: 25, userCount: 4 }), NOW).ok,
    ).toBe(true)
  })
})

describe('filing order', () => {
  it('puts production first, then the widest blast radius', () => {
    const staging = candidate({
      shortId: 'PT-S',
      primaryEnvironment: 'staging',
      userCount: 900,
    })
    const smallProd = candidate({ shortId: 'PT-A', userCount: 2 })
    const bigProd = candidate({ shortId: 'PT-B', userCount: 40 })

    expect(
      filingOrder([staging, smallProd, bigProd]).map((c) => c.shortId),
    ).toEqual(['PT-B', 'PT-A', 'PT-S'])
  })

  it('puts a forced candidate first, however small it is', () => {
    // Without this, `--max` spends itself on the qualifying candidates before the loop ever
    // reaches the one a human named, and --force silently files nothing.
    const staging = candidate({
      shortId: 'PT-S',
      primaryEnvironment: 'staging',
      userCount: 1,
      eventCount: 1,
    })
    const bigProd = candidate({ shortId: 'PT-B', userCount: 40 })

    expect(
      filingOrder([bigProd, staging], 'PT-S').map((c) => c.shortId),
    ).toEqual(['PT-S', 'PT-B'])
  })

  it('leaves the order alone when the forced id is not among them', () => {
    const smallProd = candidate({ shortId: 'PT-A', userCount: 2 })
    const bigProd = candidate({ shortId: 'PT-B', userCount: 40 })

    expect(
      filingOrder([smallProd, bigProd], 'PT-ABSENT').map((c) => c.shortId),
    ).toEqual(['PT-B', 'PT-A'])
  })
})

describe('the ticket', () => {
  const body = renderIssueBody({
    candidate: candidate(),
    sequence: 1,
    runLabel: '41207',
    reportPath: '.sandcastle/logs/sentry-triage-x.md',
  })

  it('carries the marker that makes it findable again', () => {
    expect(parseMarkers(body)).toEqual([
      { shortId: 'MONEY-TRACKER-4KQ', sequence: 1 },
    ])
  })

  it('names a file and a line in our code, which is what pre-triage reproduces from', () => {
    expect(body).toContain('src/server/repos/trips.ts:142')
  })

  it('refuses to present a guess as a diagnosis', () => {
    expect(body).toContain('Fix direction: unverified')
  })

  it('never promotes itself', () => {
    // Promotion is ADR 0006's, earned by a reproduction this routine cannot perform.
    expect(body).not.toContain('ready-for-agent')
    expect(body).not.toContain('Closes #')
  })

  it('says what a regression regressed from', () => {
    const regression = renderIssueBody({
      candidate: candidate(),
      sequence: 2,
      previous: 7,
      runLabel: '41207',
      reportPath: 'x.md',
    })

    expect(regression).toContain('#7')
    expect(parseMarkers(regression)).toEqual([
      { shortId: 'MONEY-TRACKER-4KQ', sequence: 2 },
    ])
  })

  it('records that a forced ticket did not clear the policy', () => {
    // triage.yml reproduces this at HEAD and decides whether to promote it (ADR 0006). Filing a
    // single burst as though it had cleared the thresholds would put that decision on a false
    // premise, so the ticket carries the reason it was let through.
    const forced = renderIssueBody({
      candidate: candidate(),
      sequence: 1,
      runLabel: '41207',
      reportPath: 'x.md',
      forcedReason: 'a single burst rather than a recurring defect',
    })

    expect(forced).toContain('FORCED')
    expect(forced).toContain('a single burst rather than a recurring defect')
  })

  it('claims no override on a ticket that earned its place', () => {
    expect(body).not.toContain('FORCED')
  })

  it('titles a regression as one', () => {
    expect(renderTitle(candidate(), false)).toMatch(
      /^Sentry: TypeError in src\//,
    )
    expect(renderTitle(candidate(), true)).toMatch(/^Sentry regression: /)
  })
})
