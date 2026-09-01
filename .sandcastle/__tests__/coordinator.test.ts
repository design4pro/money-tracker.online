import { describe, expect, it, vi } from 'vitest'

import { Coordinator, CoordinatorError } from '../coordinator'
import { SANDCASTLE_HEARTBEAT_INTERVAL_MS } from '../../src/server/do/sandcastle-protocol'

const RUN = {
  repo: 'design4pro/money-tracker.online',
  runId: '20260830-1',
  origin: 'local' as const,
  kind: 'afk-loop' as const,
  host: 'laptop',
}

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/** A fetch that answers each call from `replies` in turn and records what it was sent. */
function fakeFetch(replies: Array<[number, unknown]>, calls: Array<Call>) {
  let at = 0
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const [status, payload] = replies[Math.min(at, replies.length - 1)]
    at++
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body:
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as unknown)
          : undefined,
    })
    return new Response(JSON.stringify(payload), { status })
  }) as unknown as typeof globalThis.fetch
}

function coordinator(replies: Array<[number, unknown]>, calls: Array<Call>) {
  return new Coordinator({
    ...RUN,
    baseUrl: 'https://staging.money-tracker.online',
    token: 'the-token',
    accessClientId: 'access-id',
    accessClientSecret: 'access-secret',
    fetch: fakeFetch(replies, calls),
    log: () => {},
  })
}

describe('configuration', () => {
  it('refuses to start when the coordinator is not configured', () => {
    // Fail closed. An unconfigured coordinator is indistinguishable from one that is down, and both
    // mean this run cannot know what another run holds.
    expect(() => Coordinator.fromEnv({}, RUN)).toThrow(CoordinatorError)
    expect(() =>
      Coordinator.fromEnv({ SANDCASTLE_COORDINATOR_URL: 'https://x' }, RUN),
    ).toThrow(/SANDCASTLE_COORDINATOR_TOKEN/)
    expect(() =>
      Coordinator.fromEnv({ SANDCASTLE_COORDINATOR_TOKEN: 't' }, RUN),
    ).toThrow(/SANDCASTLE_COORDINATOR_URL/)
  })

  it('names --no-coordinator as the way past it, so the message is actionable', () => {
    expect(() => Coordinator.fromEnv({}, RUN)).toThrow(/--no-coordinator/)
  })

  it('treats a blank value as unset rather than as a token', () => {
    expect(() =>
      Coordinator.fromEnv(
        {
          SANDCASTLE_COORDINATOR_URL: 'https://staging.money-tracker.online',
          SANDCASTLE_COORDINATOR_TOKEN: '   ',
        },
        RUN,
      ),
    ).toThrow(CoordinatorError)
  })

  it('trims a trailing slash off the base URL so paths do not double up', async () => {
    const built = Coordinator.fromEnv(
      {
        SANDCASTLE_COORDINATOR_URL: 'https://staging.money-tracker.online/',
        SANDCASTLE_COORDINATOR_TOKEN: 'the-token',
      },
      RUN,
    )

    expect(built.baseUrl).toBe('https://staging.money-tracker.online')
  })
})

describe('requests', () => {
  it('carries the bearer token and the Access service token', async () => {
    // Staging is behind Cloudflare Access: without these the login page answers, not the Worker.
    const calls: Array<Call> = []
    await coordinator(
      [[200, { leaseTtlMs: 1, heartbeatIntervalMs: 1, resumed: false }]],
      calls,
    ).register()

    expect(calls[0].headers.authorization).toBe('Bearer the-token')
    expect(calls[0].headers['CF-Access-Client-Id']).toBe('access-id')
    expect(calls[0].headers['CF-Access-Client-Secret']).toBe('access-secret')
  })

  it('sends no Access headers when none are configured', async () => {
    const calls: Array<Call> = []
    await new Coordinator({
      ...RUN,
      baseUrl: 'https://staging.money-tracker.online',
      token: 'the-token',
      fetch: fakeFetch([[200, { revoked: [], leaseExpiresAt: 1 }]], calls),
      log: () => {},
    }).heartbeatOnce()

    expect(calls[0].headers['CF-Access-Client-Id']).toBeUndefined()
  })

  it('retries a 5xx and then succeeds', async () => {
    // Staging redeploys while runs are alive; an isolate restart drops requests in flight and a run
    // must not die of that.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const calls: Array<Call> = []
    const result = await coordinator(
      [
        [503, { error: 'restarting' }],
        [200, { revoked: [], leaseExpiresAt: 42 }],
      ],
      calls,
    ).heartbeatOnce()
    vi.useRealTimers()

    expect(calls).toHaveLength(2)
    expect(result.leaseExpiresAt).toBe(42)
  })

  it('does not retry a 4xx, because it is a verdict rather than a blip', async () => {
    const calls: Array<Call> = []
    await expect(
      coordinator([[403, { error: 'wrong token' }]], calls).heartbeatOnce(),
    ).rejects.toThrow(CoordinatorError)

    expect(calls).toHaveLength(1)
  })

  it('stops the run when the coordinator is unreachable', async () => {
    // The whole point of failing closed: no answer means no knowledge of what others hold.
    const failing = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof globalThis.fetch
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const run = new Coordinator({
      ...RUN,
      baseUrl: 'https://staging.money-tracker.online',
      token: 'the-token',
      fetch: failing,
      log: () => {},
    })

    await expect(run.register()).rejects.toThrow(/--no-coordinator/)
    vi.useRealTimers()
  })
})

describe('claiming', () => {
  it('sends the candidates and the sub-issue edges, and returns the verdict', async () => {
    const calls: Array<Call> = []
    const result = await coordinator(
      [
        [
          200,
          {
            granted: ['106'],
            denied: [{ id: '108', heldBy: '20260830-2', via: '104' }],
            adopt: { '106': 'sandcastle/issue-106-20260829-1' },
          },
        ],
      ],
      calls,
    ).claim(['106', '108'], [{ child: '106', parent: '104' }])

    expect(calls[0].url).toContain('/runs/20260830-1/claim')
    expect(calls[0].body).toEqual({
      candidates: ['106', '108'],
      edges: [{ child: '106', parent: '104' }],
    })
    expect(result.granted).toEqual(['106'])
    expect(result.denied[0].via).toBe('104')
    expect(result.adopt['106']).toBe('sandcastle/issue-106-20260829-1')
  })

  it('refuses a reply that does not match the protocol', async () => {
    // The wire is validated on the way back as well as on the way out: a coordinator answering
    // something else - an Access login page, a proxy - must not be read as an empty grant.
    const calls: Array<Call> = []
    await expect(
      coordinator([[200, { granted: 'all of them' }]], calls).claim([], []),
    ).rejects.toThrow()
  })
})

describe('losing a lease', () => {
  it('aborts the pipeline of a revoked issue and leaves the others running', async () => {
    const calls: Array<Call> = []
    const run = coordinator(
      [[200, { revoked: ['106'], leaseExpiresAt: 1 }]],
      calls,
    )
    const revoked = run.signalFor('106')
    const kept = run.signalFor('108')

    await run.heartbeatOnce()

    expect(revoked.aborted).toBe(true)
    expect(kept.aborted).toBe(false)
    expect(run.isRevoked('106')).toBe(true)
    expect(run.isRevoked('108')).toBe(false)
  })

  it('hands the same signal back for one issue, so every stage shares it', async () => {
    const run = coordinator(
      [[200, { revoked: ['106'], leaseExpiresAt: 1 }]],
      [],
    )

    expect(run.signalFor('106')).toBe(run.signalFor('106'))
  })

  it('reports an issue it never started as not revoked', async () => {
    const run = coordinator([[200, { revoked: [], leaseExpiresAt: 1 }]], [])

    expect(run.isRevoked('999')).toBe(false)
  })

  /**
   * The `revoked` list can never carry this news. The registry reaps a run and its leases in one
   * sweep, so a run that lapsed no longer exists there and every heartbeat after gets 409 - the
   * branch that computes `revoked` needs a run record that survived losing a lease, and there is no
   * such state. Swallowing the 409 as "retry next interval" is what let a lapsed run keep building
   * and merge onto an issue another fleet already held.
   */
  it('gives up every issue when the registry no longer knows the run', async () => {
    vi.useFakeTimers()
    try {
      const run = coordinator(
        [[409, { error: 'run 20260830-1 is not registered' }]],
        [],
      )
      const one = run.signalFor('106')
      const two = run.signalFor('108')

      run.startHeartbeat()
      await vi.advanceTimersByTimeAsync(SANDCASTLE_HEARTBEAT_INTERVAL_MS)

      expect(one.aborted).toBe(true)
      expect(two.aborted).toBe(true)
      expect(run.isRevoked('106')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The bug this covers: revocation used to be recorded only by aborting a controller in
   * `inFlight`, and `signalFor` does not create one until the implementer stage actually starts
   * that issue - behind `MAX_PARALLEL`, minutes after the claim. A revocation arriving while the
   * issue was still planning or queued hit an empty map and was dropped, and the controller minted
   * later read clean, so the merge-time guard let the run merge work on an issue another fleet
   * held.
   */
  it('remembers a revocation that arrives before the pipeline starts', async () => {
    vi.useFakeTimers()
    try {
      const run = coordinator(
        [[200, { revoked: ['106'], leaseExpiresAt: 1 }]],
        [],
      )

      // Claimed, not yet started: no controller exists for #106 at this point.
      await run.heartbeatOnce()

      expect(run.isRevoked('106')).toBe(true)
      // And the pipeline, when it finally gets its turn, is handed a signal that is already spent.
      expect(run.signalFor('106').aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up an issue it never started when the run itself lapses', async () => {
    vi.useFakeTimers()
    try {
      const run = coordinator(
        [[409, { error: 'run 20260830-1 is not registered' }]],
        [],
      )

      run.startHeartbeat()
      await vi.advanceTimersByTimeAsync(SANDCASTLE_HEARTBEAT_INTERVAL_MS)

      // Nothing was ever in flight, and the 409 names no ids - leases are reaped with the run, so
      // it is news about every issue this run claimed, including ones still queued.
      expect(run.isRevoked('106')).toBe(true)
      expect(run.signalFor('106').aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('survives a 5xx heartbeat instead of tearing the run down', async () => {
    vi.useFakeTimers()
    const run = coordinator([[503, { error: 'no' }]], [])
    try {
      const one = run.signalFor('106')

      run.startHeartbeat()
      await vi.advanceTimersByTimeAsync(SANDCASTLE_HEARTBEAT_INTERVAL_MS * 2)

      expect(one.aborted).toBe(false)
    } finally {
      run.stopHeartbeat()
      vi.useRealTimers()
    }
  })
})

describe('the run lifecycle', () => {
  it('registers, then finishes and stops heartbeating', async () => {
    const calls: Array<Call> = []
    const run = coordinator(
      [
        [200, { leaseTtlMs: 1, heartbeatIntervalMs: 1, resumed: true }],
        [200, {}],
      ],
      calls,
    )

    await run.register()
    run.startHeartbeat()
    await run.finish('finished', 'all merged')

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/sandcastle/runs/register',
      '/api/sandcastle/runs/20260830-1/finish',
    ])
    expect(calls[1].body).toEqual({ status: 'finished', summary: 'all merged' })
  })

  it('releases named issues, or all of them', async () => {
    const calls: Array<Call> = []
    const run = coordinator(
      [
        [200, {}],
        [200, {}],
      ],
      calls,
    )

    await run.release(['106'])
    await run.release()

    expect(calls[0].body).toEqual({ ids: ['106'] })
    expect(calls[1].body).toEqual({})
  })

  /**
   * Both are cleanup verbs, and both are called where an exception is at its most destructive: from
   * a `finally` in `triage.ts`, from a signal handler, and from the last line of `main.ts` after
   * every merge is already done. A 409 there says the registry reaped the run first - which is
   * what the call was asking for - so failing a job over it, or replacing the error already on its
   * way out of a `finally`, is the wrong answer to good news.
   */
  it('treats a run the registry already reaped as released and finished', async () => {
    const run = coordinator(
      [[409, { error: 'run 20260830-1 is not registered' }]],
      [],
    )

    await expect(run.finish('finished')).resolves.toBeUndefined()
    await expect(run.release(['106'])).resolves.toBeUndefined()
  })

  it('still throws on a refusal that is not that', async () => {
    const run = coordinator([[403, { error: 'bad token' }]], [])

    await expect(run.finish('finished')).rejects.toThrow(CoordinatorError)
    await expect(run.release()).rejects.toThrow(CoordinatorError)
  })

  it('records work in progress against the branch that carries it', async () => {
    const calls: Array<Call> = []
    await coordinator([[200, {}]], calls).recordWip(
      '106',
      'sandcastle/issue-106-20260830-1',
      3,
    )

    expect(calls[0].url).toContain('/runs/20260830-1/wip')
    expect(calls[0].body).toEqual({
      issueId: '106',
      branch: 'sandcastle/issue-106-20260830-1',
      commits: 3,
    })
  })

  it('sends the stage it was last told, so the dashboard tracks progress', async () => {
    const calls: Array<Call> = []
    const run = coordinator([[200, { revoked: [], leaseExpiresAt: 1 }]], calls)

    run.setStage('implementing')
    await run.heartbeatOnce()

    expect(calls[0].body).toEqual({ stage: 'implementing' })
  })
})
