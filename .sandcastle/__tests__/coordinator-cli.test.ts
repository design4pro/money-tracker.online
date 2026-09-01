import { describe, expect, it } from 'vitest'

import { CoordinatorError } from '../coordinator'
import {
  EXIT_DENIED,
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  parseCoordinatorArgs,
  runCoordinatorCli,
} from '../coordinator-cli'

import type { Coordinator } from '../coordinator'
import type { ClaimResult } from '../../src/server/do/sandcastle-protocol'

const START = ['start', '--run', 'triage-106-9', '--kind', 'triage']

interface FakeCalls {
  registered: Array<string | null>
  claimed: Array<Array<string>>
  released: Array<Array<string> | undefined>
  finished: Array<[string, string]>
}

/** A coordinator that records what it was asked and answers what the test says. */
function fakeCoordinator(
  calls: FakeCalls,
  answers: {
    claim?: ClaimResult
    finish?: Error
  } = {},
): Coordinator {
  return {
    async register(branch: string | null = null) {
      calls.registered.push(branch)
    },
    async claim(candidates: Array<string>) {
      calls.claimed.push(candidates)
      return answers.claim ?? { granted: candidates, denied: [], adopt: {} }
    },
    async release(ids?: Array<string>) {
      calls.released.push(ids)
    },
    async finish(status: string, summary: string) {
      calls.finished.push([status, summary])
      if (answers.finish !== undefined) throw answers.finish
    },
  } as unknown as Coordinator
}

function harness(answers: Parameters<typeof fakeCoordinator>[1] = {}): {
  calls: FakeCalls
  deps: Parameters<typeof runCoordinatorCli>[1]
  said: Array<string>
} {
  const calls: FakeCalls = {
    registered: [],
    claimed: [],
    released: [],
    finished: [],
  }
  const said: Array<string> = []
  return {
    calls,
    said,
    deps: {
      env: {},
      log: (message: string) => said.push(message),
      build: () => fakeCoordinator(calls, answers),
    },
  }
}

describe('parsing', () => {
  it('takes the two verbs and nothing else', () => {
    expect(parseCoordinatorArgs(START).verb).toBe('start')
    expect(() => parseCoordinatorArgs([])).toThrow(/start.*finish/)
    expect(() => parseCoordinatorArgs(['claim'])).toThrow(/`claim`/)
  })

  it('refuses a flag it does not know rather than ignoring it', () => {
    // The mistake this whole mechanism exists because of: `main.ts` swallowed `--issue 104`, the
    // run went unscoped, and a second fleet rebuilt two tickets.
    expect(() => parseCoordinatorArgs([...START, '--issue', '106'])).toThrow(
      /Unknown flag/,
    )
  })

  it('insists on a run id and a known kind', () => {
    expect(() => parseCoordinatorArgs(['start', '--kind', 'triage'])).toThrow(
      /--run/,
    )
    expect(() =>
      parseCoordinatorArgs(['start', '--run', 'r', '--kind', 'wizardry']),
    ).toThrow(/--kind/)
  })

  it('splits issues on whatever a shell made easy', () => {
    expect(
      parseCoordinatorArgs([...START, '--issues', '106,108']).issues,
    ).toEqual(['106', '108'])
    expect(
      parseCoordinatorArgs([...START, '--issues', ' 106  108 ']).issues,
    ).toEqual(['106', '108'])
    expect(parseCoordinatorArgs(START).issues).toEqual([])
  })

  it('refuses a status that is neither ending', () => {
    expect(() =>
      parseCoordinatorArgs([
        'finish',
        '--run',
        'r',
        '--kind',
        'triage',
        '--status',
        'cancelled',
      ]),
    ).toThrow(/--status/)
  })
})

describe('start', () => {
  it('registers and claims, and says nothing when it got everything', async () => {
    const { calls, deps } = harness()

    const code = await runCoordinatorCli([...START, '--issues', '106'], deps)

    expect(code).toBe(EXIT_OK)
    expect(calls.registered).toEqual([null])
    expect(calls.claimed).toEqual([['106']])
  })

  it('registers and claims nothing when no issue was named', async () => {
    // The dashboard case: `sentry-triage` files new issues rather than working existing ones, so it
    // announces itself and holds nothing.
    const { calls, deps } = harness()

    const code = await runCoordinatorCli(START, deps)

    expect(code).toBe(EXIT_OK)
    expect(calls.registered).toEqual([null])
    expect(calls.claimed).toEqual([])
  })

  it('stands down with its own exit code when another run holds the issue', async () => {
    const { deps, said } = harness({
      claim: {
        granted: [],
        denied: [{ id: '106', heldBy: '20260830-1', via: '104' }],
        adopt: {},
      },
    })

    const code = await runCoordinatorCli([...START, '--issues', '106'], deps)

    // Not 1: "somebody else has it" is a normal outcome a workflow skips on, and a caller that
    // cannot tell it from an unreachable registry stops triaging the day a secret expires.
    expect(code).toBe(EXIT_DENIED)
    expect(said.join(' ')).toContain('held by run 20260830-1 via #104')
  })

  it('ends the run it registered rather than leaving it to expire', async () => {
    const { calls, deps } = harness({
      claim: {
        granted: ['108'],
        denied: [{ id: '106', heldBy: '20260830-1', via: '106' }],
        adopt: {},
      },
    })

    const code = await runCoordinatorCli(
      [...START, '--issues', '106,108'],
      deps,
    )

    // Nothing heartbeats after this process exits, so a partial claim left behind would park #108
    // for a whole lease while the dashboard showed a run that had already gone.
    expect(code).toBe(EXIT_DENIED)
    expect(calls.finished).toEqual([
      ['finished', 'stood down: an issue was held elsewhere'],
    ])
  })

  it('reports an unreachable coordinator as a failure, not as a denial', async () => {
    const { deps } = harness()
    const code = await runCoordinatorCli([...START, '--issues', '106'], {
      ...deps,
      build: () => {
        throw new CoordinatorError('SANDCASTLE_COORDINATOR_URL is not set')
      },
    })

    expect(code).toBe(EXIT_FAILED)
  })
})

describe('finish', () => {
  it('ends the run', async () => {
    const { calls, deps } = harness()

    const code = await runCoordinatorCli(
      ['finish', '--run', 'r', '--kind', 'triage', '--summary', 'promoted'],
      deps,
    )

    expect(code).toBe(EXIT_OK)
    expect(calls.finished).toEqual([['finished', 'promoted']])
  })

  // "the registry got there first" is no longer the CLI's business: `Coordinator.finish` swallows
  // that 409 itself, so every caller gets the rule and not just this one. Covered in
  // `coordinator.test.ts`.

  it('still fails on a refusal that is not that', async () => {
    const { deps } = harness({
      finish: new CoordinatorError('bad token', 403),
    })

    const code = await runCoordinatorCli(
      ['finish', '--run', 'r', '--kind', 'triage'],
      deps,
    )

    expect(code).toBe(EXIT_FAILED)
  })
})

describe('usage', () => {
  it('answers a wrong invocation with its own exit code', async () => {
    const { deps, said } = harness()

    expect(await runCoordinatorCli(['start'], deps)).toBe(EXIT_USAGE)
    expect(said).toHaveLength(1)
  })
})
