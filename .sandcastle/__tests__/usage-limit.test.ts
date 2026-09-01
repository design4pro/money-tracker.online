import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STAGE_LOG_NAME, openStageLog, resetStageLog } from '../stage-log'
import {
  BLIND_WAIT_MS,
  WAKE_MARGIN_MS,
  parseUsageLimit,
  resetUsageLimitGate,
  withUsageLimit,
} from '../usage-limit'

/**
 * The message that actually ended a run, copied from the operator's terminal. Every other case here
 * is a variation on it; this one is the reason the module exists, so it is the one that must never
 * silently stop matching.
 */
const OBSERVED = [
  'claude-code exited with code 1:',
  "You've hit your session limit · resets 12:20am (UTC)",
].join('\n')

const NOON = new Date('2026-08-30T12:00:00.000Z')

describe('parseUsageLimit', () => {
  it('reads the reset clock out of the message that ended run 20260830-4', () => {
    const limit = parseUsageLimit(new Error(OBSERVED), NOON)
    expect(limit).toEqual({
      resetsAt: new Date('2026-08-31T00:20:00.000Z'),
      precise: true,
    })
  })

  it('reads 12:xxpm as noon, not midnight', () => {
    const limit = parseUsageLimit(
      new Error(
        'claude-code exited with code 1:\nusage limit reached, resets 12:20pm (UTC)',
      ),
      new Date('2026-08-30T06:00:00.000Z'),
    )
    expect(limit?.resetsAt).toEqual(new Date('2026-08-30T12:20:00.000Z'))
  })

  it('reads an afternoon clock', () => {
    const limit = parseUsageLimit(
      new Error(
        "claude-code exited with code 1:\nYou've hit your session limit · resets 3:05pm (UTC)",
      ),
      new Date('2026-08-30T06:00:00.000Z'),
    )
    expect(limit?.resetsAt).toEqual(new Date('2026-08-30T15:05:00.000Z'))
  })

  it('rolls a reset time that has already passed today into tomorrow', () => {
    const limit = parseUsageLimit(
      new Error(
        "claude-code exited with code 1:\nYou've hit your session limit · resets 9:00am (UTC)",
      ),
      new Date('2026-08-30T14:00:00.000Z'),
    )
    expect(limit?.resetsAt).toEqual(new Date('2026-08-31T09:00:00.000Z'))
  })

  it('reads the older epoch form', () => {
    const limit = parseUsageLimit(
      new Error(
        'claude-code exited with code 1:\nClaude AI usage limit reached|1756612800',
      ),
      NOON,
    )
    expect(limit).toEqual({
      resetsAt: new Date(1756612800 * 1000),
      precise: true,
    })
  })

  it('falls back to a blind wait when the limit carries no reset time', () => {
    const limit = parseUsageLimit(
      new Error('claude-code exited with code 1:\nrate limit exceeded'),
      NOON,
    )
    expect(limit).toEqual({
      resetsAt: new Date(NOON.getTime() + BLIND_WAIT_MS),
      precise: false,
    })
  })

  it('matches a limit reported only as a 429', () => {
    expect(
      parseUsageLimit(
        new Error('claude-code exited with code 1:\nHTTP 429'),
        NOON,
      ),
    ).toBeDefined()
  })

  it('reads the message through a wrapper error, as Effect delivers it', () => {
    const wrapped = new Error(`(FiberFailure) AgentError: ${OBSERVED}`)
    expect(parseUsageLimit(wrapped, NOON)?.precise).toBe(true)
  })

  describe('is not a limit', () => {
    it('an agent that exited because the build broke', () => {
      expect(
        parseUsageLimit(
          new Error('claude-code exited with code 1:\ntsc: 3 errors'),
          NOON,
        ),
      ).toBeUndefined()
    })

    it('a limit-shaped string that did not come from an agent exiting', () => {
      expect(
        parseUsageLimit(
          new Error(
            'CoordinatorError: 429 Too Many Requests from the registry',
          ),
          NOON,
        ),
      ).toBeUndefined()
    })

    it('anything that is not an error at all', () => {
      expect(parseUsageLimit(undefined, NOON)).toBeUndefined()
      expect(parseUsageLimit('exited with code 1', NOON)).toBeUndefined()
    })
  })
})

describe('withUsageLimit', () => {
  /**
   * A clock that never really waits, so the tests state the schedule rather than live through it.
   * It sits an hour and twenty minutes before the observed message's reset — the shape a real
   * limit has, where the window is hours rather than the half-day a midday `now` would imply.
   */
  const LATE = new Date('2026-08-30T23:00:00.000Z')
  const RESETS_AT = new Date('2026-08-31T00:20:00.000Z')

  function fakeClock(slept: Array<number> = []) {
    return {
      slept,
      clock: {
        now: () => LATE,
        sleep: async (ms: number) => {
          slept.push(ms)
        },
      },
    }
  }

  beforeEach(() => {
    resetUsageLimitGate()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetUsageLimitGate()
  })

  it('passes a result straight through', async () => {
    const { clock, slept } = fakeClock()
    await expect(
      withUsageLimit('planner', async () => 'ok', { clock }),
    ).resolves.toBe('ok')
    expect(slept).toEqual([])
  })

  it('waits until the reset, plus a margin, then runs the stage again', async () => {
    const { clock, slept } = fakeClock()
    let calls = 0
    const result = await withUsageLimit(
      'implementer',
      async () => {
        calls++
        if (calls === 1) throw new Error(OBSERVED)
        return 'second time'
      },
      { clock },
    )
    expect(result).toBe('second time')
    expect(calls).toBe(2)
    expect(slept).toEqual([
      RESETS_AT.getTime() - LATE.getTime() + WAKE_MARGIN_MS,
    ])
  })

  it('rethrows anything that is not a usage limit, without waiting', async () => {
    const { clock, slept } = fakeClock()
    let calls = 0
    await expect(
      withUsageLimit(
        'reviewer',
        async () => {
          calls++
          throw new Error('claude-code exited with code 1:\ntsc: 3 errors')
        },
        { clock },
      ),
    ).rejects.toThrow('tsc: 3 errors')
    expect(calls).toBe(1)
    expect(slept).toEqual([])
  })

  it('makes two concurrent stages share one wait rather than each starting its own', async () => {
    const { clock, slept } = fakeClock()
    const stage = (label: string) => {
      let calls = 0
      return withUsageLimit(
        label,
        async () => {
          calls++
          if (calls === 1) throw new Error(OBSERVED)
          return label
        },
        { clock },
      )
    }
    await expect(
      Promise.all([stage('issue-a'), stage('issue-b')]),
    ).resolves.toEqual(['issue-a', 'issue-b'])
    // One timer, not two: the second caller joined the first one's wait.
    expect(slept).toHaveLength(1)
  })

  it('gives up rather than looping when the limit never lifts', async () => {
    const { clock, slept } = fakeClock()
    let calls = 0
    await expect(
      withUsageLimit(
        'auditor',
        async () => {
          calls++
          throw new Error(OBSERVED)
        },
        { clock },
      ),
    ).rejects.toThrow(/session limit/)
    expect(calls).toBe(4)
    expect(slept).toHaveLength(3)
  })

  it('refuses a wait longer than the ceiling and says how to resume', async () => {
    const { clock } = fakeClock()
    await expect(
      withUsageLimit(
        'planner',
        async () => {
          throw new Error(
            'claude-code exited with code 1:\nClaude AI usage limit reached|9999999999',
          )
        },
        { clock },
      ),
    ).rejects.toThrow(/SANDCASTLE_LIMIT_WAIT_MAX_MS[\s\S]*--run/)
  })
  /**
   * A wait that stays open until the test says otherwise, so an abort can land mid-window. It
   * ignores its cancel signal on purpose: what these two tests assert is which caller the shared
   * timer answers to, not how it is torn down.
   */
  function heldClock() {
    const slept: Array<number> = []
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    return {
      slept,
      release: () => {
        release()
      },
      clock: {
        now: () => LATE,
        sleep: async (ms: number) => {
          slept.push(ms)
          await gate
        },
      },
    }
  }

  /** Lets every microtask settle, so both stages are inside the wait before anything is aborted. */
  const settle = () => new Promise((resolve) => setImmediate(resolve))

  function limitedOnce(
    label: string,
    signal: AbortSignal,
    clock: ReturnType<typeof heldClock>['clock'],
  ) {
    let calls = 0
    return withUsageLimit(
      label,
      async () => {
        calls++
        if (calls === 1) throw new Error(OBSERVED)
        return label
      },
      { clock, signal },
    )
  }

  it('fails only the stage whose own lease was revoked, not the one it waits beside', async () => {
    const { clock, release } = heldClock()
    const revoked = new AbortController()
    // The leader owns the timer; before the fix its signal was the timer's, so aborting it here
    // rejected the shared promise and took the joiner down with an abort it never suffered.
    const leader = limitedOnce('issue-a', revoked.signal, clock)
    await settle()
    const joiner = limitedOnce('issue-b', new AbortController().signal, clock)
    await settle()

    revoked.abort(new Error('lease revoked'))
    await expect(leader).rejects.toThrow('lease revoked')

    release()
    await expect(joiner).resolves.toBe('issue-b')
  })

  it('wakes a joiner whose own lease is revoked instead of sleeping out the window', async () => {
    const { clock, release } = heldClock()
    const revoked = new AbortController()
    const leader = limitedOnce('issue-a', new AbortController().signal, clock)
    await settle()
    const joiner = limitedOnce('issue-b', revoked.signal, clock)
    await settle()

    // A joiner used to await the leader's timer and nothing else, so its own revocation was not
    // noticed until the window closed — hours later, on an issue another machine may hold by then.
    revoked.abort(new Error('lease revoked'))
    await expect(joiner).rejects.toThrow('lease revoked')

    release()
    await expect(leader).resolves.toBe('issue-a')
  })
})

/**
 * The wait/work split, which is the whole reason the timeline exists: a run is ~20 h of wall clock
 * and until now nothing said how much of that was an agent working and how much was this module
 * sitting out a limit. `withUsageLimit` is the only place that can tell the two apart.
 */
describe('withUsageLimit writes a stage record', () => {
  const START = new Date('2026-08-30T23:00:00.000Z')

  /** A clock that advances only when the code under test sleeps, so the schedule is stated, not lived. */
  function advancingClock() {
    let at = START.getTime()
    return {
      tick: (ms: number) => {
        at += ms
      },
      clock: {
        now: () => new Date(at),
        sleep: async (ms: number) => {
          at += ms
        },
      },
    }
  }

  let dir: string

  function stages(): Array<Record<string, unknown>> {
    return readFileSync(join(dir, STAGE_LOG_NAME), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  beforeEach(() => {
    resetUsageLimitGate()
    resetStageLog()
    dir = mkdtempSync(join(tmpdir(), 'usage-limit-log-'))
    openStageLog('20260830-4', dir)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetStageLog()
    resetUsageLimitGate()
    rmSync(dir, { recursive: true, force: true })
  })

  it('records a clean stage as all work and no wait', async () => {
    const { clock, tick } = advancingClock()
    await withUsageLimit(
      'reviewer',
      async () => {
        tick(90_000)
        return { iterations: [{ usage: { outputTokens: 7 } }] }
      },
      { clock, meta: { issue: '169', attempt: 1, model: 'claude-opus-5' } },
    )

    expect(stages()).toEqual([
      expect.objectContaining({
        kind: 'stage',
        label: 'reviewer',
        issue: '169',
        attempt: 1,
        model: 'claude-opus-5',
        wallMs: 90_000,
        waitMs: 0,
        workMs: 90_000,
        waits: 0,
        outcome: 'ok',
        tokens: {
          input: 0,
          cacheCreate: 0,
          cacheRead: 0,
          output: 7,
          iterations: 1,
        },
      }),
    ])
  })

  it('books the limit window as wait, not as work', async () => {
    const { clock, tick } = advancingClock()
    let calls = 0
    await withUsageLimit(
      'implementer',
      async () => {
        calls++
        tick(10_000)
        if (calls === 1) throw new Error(OBSERVED)
        return 'done'
      },
      { clock, meta: { issue: '169' } },
    )

    const written = stages()
    const wait = written.find((line) => line.kind === 'wait')!
    const stage = written.find((line) => line.kind === 'stage')!

    // The observed message resets at 00:20Z; the first attempt burned ten seconds before hitting
    // the limit, so the window is what is left until the reset, plus the wake margin.
    const window = 80 * 60_000 - 10_000 + WAKE_MARGIN_MS
    expect(wait).toMatchObject({ ms: window, joined: false, precise: true })
    expect(stage).toMatchObject({
      label: 'implementer',
      waits: 1,
      waitMs: window,
      workMs: 20_000,
      wallMs: window + 20_000,
      outcome: 'ok',
    })
  })

  it('records a real failure and still rethrows it', async () => {
    const { clock } = advancingClock()
    await expect(
      withUsageLimit(
        'merger',
        async () => {
          throw new Error('merge conflict in src/routeTree.gen.ts\nmore detail')
        },
        { clock, meta: {} },
      ),
    ).rejects.toThrow('merge conflict')

    expect(stages()).toEqual([
      expect.objectContaining({
        label: 'merger',
        outcome: 'error',
        error: 'merge conflict in src/routeTree.gen.ts',
        waits: 0,
      }),
    ])
  })

  it('marks a revoked lease as aborted rather than as a failure', async () => {
    const { clock } = advancingClock()
    const revoked = new AbortController()
    revoked.abort(new Error('lease revoked'))

    await expect(
      withUsageLimit(
        'implementer',
        async () => {
          throw revoked.signal.reason as Error
        },
        { clock, signal: revoked.signal, meta: { issue: '170' } },
      ),
    ).rejects.toThrow('lease revoked')

    expect(stages()).toEqual([
      expect.objectContaining({ label: 'implementer', outcome: 'aborted' }),
    ])
  })
})
