import { describe, expect, it } from 'vitest'

import {
  HEARTBEAT_STALE_MS,
  RUN_LABEL_ESCALATE_MS,
  RUN_LABEL_WARN_MS,
  activeRunFor,
  ownedPathsOf,
  pathsOverlap,
  sweep,
} from '../state.mjs'

const NOW = Date.parse('2026-09-02T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

type Issue = Parameters<typeof sweep>[0]['issues'][number]
const issue = (over: Partial<Issue> & { number: number }): Issue => ({
  state: 'OPEN',
  title: `#${over.number}`,
  labels: [],
  parent: null,
  subIssues: { total: 0, completed: 0 },
  blockedBy: [],
  claim: null,
  runLabeledAt: null,
  ownedPaths: [],
  ...over,
})
const run = (snapshot: Partial<Parameters<typeof sweep>[0]>) =>
  sweep({ issues: [], prs: [], runs: [], ...snapshot }, NOW)
const codes = (r: ReturnType<typeof sweep>) => [
  ...r.violations.map((v) => v.code),
  ...r.actions.map((a) => a.code),
]

describe('sweep: invariants', () => {
  it('I-1 flags zero or two status labels, never one', () => {
    const r = run({
      issues: [
        issue({ number: 1, labels: ['type: bug'] }),
        issue({
          number: 2,
          labels: ['type: bug', 'status: ready', 'status: triage'],
        }),
        issue({ number: 3, labels: ['type: bug', 'status: ready'] }),
      ],
    })
    expect(
      r.violations.filter((v) => v.code === 'I-1').map((v) => v.issue),
    ).toEqual([1, 2])
  })

  it('I-2 wants a type on parentless issues and none on tickets', () => {
    const r = run({
      issues: [
        issue({ number: 1, labels: ['status: triage'] }),
        issue({ number: 2, parent: 9, labels: ['status: ready', 'type: bug'] }),
        issue({ number: 3, parent: 9, labels: ['status: ready'] }),
      ],
    })
    expect(
      r.violations.filter((v) => v.code === 'I-2').map((v) => v.issue),
    ).toEqual([1, 2])
  })

  it('I-3 adds prd to an issue with sub-issues and reports a prd without the PRD: title', () => {
    const r = run({
      issues: [
        issue({
          number: 1,
          title: 'PRD: trips',
          labels: ['type: feature', 'status: in-progress'],
          subIssues: { total: 2, completed: 0 },
        }),
        issue({
          number: 2,
          title: 'not a prd title',
          labels: ['type: feature', 'status: review', 'prd'],
        }),
      ],
    })
    expect(r.actions).toContainEqual(
      expect.objectContaining({
        code: 'I-3',
        issue: 1,
        op: 'add',
        label: 'prd',
      }),
    )
    expect(r.violations).toContainEqual(
      expect.objectContaining({ code: 'I-3', issue: 2 }),
    )
  })

  it('I-4 warns after 30 min and escalates after 2 h when no run claimed the command', () => {
    const fresh = issue({
      number: 1,
      labels: ['type: bug', 'status: ready', 'run: implement'],
      runLabeledAt: ago(5 * 60_000),
    })
    const warn = issue({
      number: 2,
      labels: ['type: bug', 'status: ready', 'run: implement'],
      runLabeledAt: ago(RUN_LABEL_WARN_MS + 1),
    })
    const late = issue({
      number: 3,
      labels: ['type: bug', 'status: ready', 'run: implement'],
      runLabeledAt: ago(RUN_LABEL_ESCALATE_MS + 1),
    })
    const r = run({ issues: [fresh, warn, late] })
    expect(r.actions.filter((a) => a.issue === 1)).toEqual([])
    expect(r.actions.filter((a) => a.issue === 2).map((a) => a.op)).toEqual([
      'comment',
    ])
    expect(r.actions.filter((a) => a.issue === 3)).toEqual([
      expect.objectContaining({ op: 'remove', label: 'run: implement' }),
      expect.objectContaining({ op: 'swap', to: 'status: needs-human' }),
      expect.objectContaining({ op: 'comment' }),
    ])
  })

  it('I-4 does not escalate while cezar is unreachable or while a run holds the issue', () => {
    const late = issue({
      number: 3,
      labels: ['type: bug', 'status: ready', 'run: implement'],
      runLabeledAt: ago(RUN_LABEL_ESCALATE_MS + 1),
    })
    const unreachable = run({ issues: [late], runs: null })
    expect(unreachable.actions).toEqual([])
    expect(unreachable.violations).toContainEqual(
      expect.objectContaining({ code: 'I-4', issue: 3 }),
    )
    const held = run({
      issues: [late],
      runs: [
        {
          id: 'r1',
          status: 'running',
          autoResumeAt: null,
          task: '3 https://x',
        },
      ],
    })
    expect(codes(held)).not.toContain('I-4')
  })

  it('I-5 moves queued to ready when the blockers close, and back when a blocker is open', () => {
    const r = run({
      issues: [
        issue({ number: 10, state: 'CLOSED' }),
        issue({ number: 11, labels: ['status: ready'] }),
        issue({
          number: 12,
          parent: 1,
          labels: ['status: queued'],
          blockedBy: [{ number: 10, state: 'CLOSED' }],
        }),
        issue({
          number: 13,
          parent: 1,
          labels: ['status: ready'],
          blockedBy: [{ number: 11, state: 'OPEN' }],
        }),
      ],
    })
    expect(r.actions).toContainEqual(
      expect.objectContaining({
        code: 'I-5',
        issue: 12,
        op: 'swap',
        to: 'status: ready',
      }),
    )
    expect(r.actions).toContainEqual(
      expect.objectContaining({
        code: 'I-5',
        issue: 13,
        op: 'swap',
        to: 'status: queued',
      }),
    )
  })

  it('auto-advance on the PRD adds run: implement to a child that just became ready', () => {
    const r = run({
      issues: [
        issue({
          number: 1,
          title: 'PRD: x',
          labels: [
            'type: feature',
            'status: in-progress',
            'prd',
            'auto-advance',
          ],
          subIssues: { total: 2, completed: 1 },
        }),
        issue({ number: 2, parent: 1, state: 'CLOSED' }),
        issue({
          number: 3,
          parent: 1,
          labels: ['status: queued'],
          blockedBy: [{ number: 2, state: 'CLOSED' }],
        }),
      ],
    })
    expect(r.actions.filter((a) => a.issue === 3).map((a) => a.op)).toEqual([
      'swap',
      'add',
    ])
    expect(r.actions).toContainEqual(
      expect.objectContaining({ issue: 3, op: 'add', label: 'run: implement' }),
    )
  })

  it('I-6 escalates a ticket with a stale heartbeat and no run, but not one cezar still holds', () => {
    const stale = issue({
      number: 5,
      parent: 1,
      labels: ['status: in-progress'],
      claim: { runId: 'abcdef12-0', heartbeatAt: ago(HEARTBEAT_STALE_MS + 1) },
    })
    const gone = run({ issues: [stale] })
    expect(gone.actions).toEqual([
      expect.objectContaining({
        code: 'I-6',
        issue: 5,
        op: 'swap',
        to: 'status: needs-human',
      }),
      expect.objectContaining({
        code: 'I-6',
        issue: 5,
        op: 'comment',
        body: expect.stringContaining('claude/issue-5-abcdef12'),
      }),
    ])
    const parked = run({
      issues: [stale],
      runs: [
        {
          id: 'abcdef12-0',
          status: 'failed',
          autoResumeAt: ago(-3600_000),
          task: '5',
        },
      ],
    })
    expect(codes(parked)).not.toContain('I-6')
    const recent = run({
      issues: [{ ...stale, claim: { runId: 'x', heartbeatAt: ago(60_000) } }],
    })
    expect(codes(recent)).not.toContain('I-6')
  })

  it('I-6 escalates a planning issue without a run, skips a PRD with open children, reports when cezar is down', () => {
    const spec = issue({
      number: 6,
      labels: ['type: feature', 'status: in-progress'],
    })
    const prd = issue({
      number: 7,
      title: 'PRD: y',
      labels: ['type: feature', 'status: in-progress', 'prd'],
      subIssues: { total: 3, completed: 1 },
    })
    const r = run({ issues: [spec, prd] })
    expect(r.actions.filter((a) => a.issue === 6).map((a) => a.op)).toEqual([
      'swap',
      'comment',
    ])
    expect(r.actions.filter((a) => a.issue === 7)).toEqual([])
    const down = run({ issues: [spec], runs: null })
    expect(down.actions).toEqual([])
    expect(down.violations).toContainEqual(
      expect.objectContaining({ code: 'I-6', issue: 6 }),
    )
  })

  it('I-7 pairs review tickets with open agent PRs in both directions', () => {
    const r = run({
      issues: [
        issue({ number: 8, parent: 1, labels: ['status: review'] }),
        issue({ number: 9, parent: 1, labels: ['status: in-progress'] }),
      ],
      prs: [{ number: 50, state: 'OPEN', labels: ['agent-pr'], refs: [9] }],
    })
    expect(
      r.violations.filter((v) => v.code === 'I-7').map((v) => v.issue),
    ).toEqual([8, 9])
  })

  it('I-8 and I-9 strip run: and auto-advance from closed issues and auto-advance from non-PRDs', () => {
    const r = run({
      issues: [
        issue({
          number: 1,
          state: 'CLOSED',
          labels: ['run: implement', 'auto-advance'],
        }),
        issue({
          number: 2,
          labels: ['type: bug', 'status: ready', 'auto-advance'],
        }),
      ],
    })
    expect(r.actions).toEqual([
      expect.objectContaining({
        code: 'I-8',
        issue: 1,
        op: 'remove',
        label: 'run: implement',
      }),
      expect.objectContaining({
        code: 'I-9',
        issue: 1,
        op: 'remove',
        label: 'auto-advance',
      }),
      expect.objectContaining({
        code: 'I-9',
        issue: 2,
        op: 'remove',
        label: 'auto-advance',
      }),
    ])
  })

  it('I-10 reports overlapping owned paths among in-progress siblings only', () => {
    const r = run({
      issues: [
        issue({
          number: 1,
          parent: 9,
          labels: ['status: in-progress'],
          ownedPaths: ['src/a', 'src/b/x.ts'],
          claim: { runId: 'r', heartbeatAt: ago(0) },
        }),
        issue({
          number: 2,
          parent: 9,
          labels: ['status: in-progress'],
          ownedPaths: ['src/b'],
          claim: { runId: 'r', heartbeatAt: ago(0) },
        }),
        issue({
          number: 3,
          parent: 8,
          labels: ['status: in-progress'],
          ownedPaths: ['src/a'],
          claim: { runId: 'r', heartbeatAt: ago(0) },
        }),
      ],
    })
    expect(r.violations.filter((v) => v.code === 'I-10')).toEqual([
      expect.objectContaining({
        issue: 1,
        message: expect.stringContaining('#2: src/b/x.ts'),
      }),
    ])
  })
})

describe('sweep: transitions driven by pull requests', () => {
  it('closes the ticket of a merged agent PR and unblocks its sibling in the same pass', () => {
    const r = run({
      issues: [
        issue({
          number: 1,
          title: 'PRD: z',
          labels: ['type: feature', 'status: in-progress', 'prd'],
          subIssues: { total: 2, completed: 0 },
        }),
        issue({ number: 2, parent: 1, labels: ['status: review'] }),
        issue({
          number: 3,
          parent: 1,
          labels: ['status: queued'],
          blockedBy: [{ number: 2, state: 'OPEN' }],
        }),
      ],
      prs: [{ number: 70, state: 'MERGED', labels: ['agent-pr'], refs: [2] }],
    })
    expect(r.actions).toContainEqual(
      expect.objectContaining({ code: 'PR-merged', issue: 2, op: 'close' }),
    )
    expect(r.actions).toContainEqual(
      expect.objectContaining({
        code: 'I-5',
        issue: 3,
        op: 'swap',
        to: 'status: ready',
      }),
    )
    expect(r.violations).toEqual([])
  })

  it('closes a PRD once every child is closed', () => {
    const r = run({
      issues: [
        issue({
          number: 1,
          title: 'PRD: z',
          labels: ['type: feature', 'status: in-progress', 'prd'],
          subIssues: { total: 1, completed: 1 },
        }),
        issue({ number: 2, parent: 1, state: 'CLOSED' }),
      ],
    })
    expect(r.actions).toEqual([
      expect.objectContaining({ code: 'PRD-done', issue: 1, op: 'close' }),
    ])
  })

  it('marks a review ticket needs-human when its PR was closed without a merge', () => {
    const r = run({
      issues: [issue({ number: 2, parent: 1, labels: ['status: review'] })],
      prs: [{ number: 71, state: 'CLOSED', labels: ['agent-pr'], refs: [2] }],
    })
    expect(r.actions.map((a) => a.op)).toEqual(['swap', 'comment'])
    expect(r.actions[0]).toMatchObject({
      code: 'PR-closed',
      to: 'status: needs-human',
    })
  })

  it('ignores PRs without the agent-pr label and prefers an open PR over an older merged one', () => {
    const r = run({
      issues: [issue({ number: 2, parent: 1, labels: ['status: review'] })],
      prs: [
        { number: 72, state: 'MERGED', labels: [], refs: [2] },
        { number: 73, state: 'MERGED', labels: ['agent-pr'], refs: [2] },
        { number: 74, state: 'OPEN', labels: ['agent-pr'], refs: [2] },
      ],
    })
    expect(r.actions).toEqual([])
    expect(r.violations).toEqual([])
  })
})

describe('helpers', () => {
  it('activeRunFor matches the first integer of the task and the live statuses', () => {
    const target = issue({ number: 42 })
    const runs = [
      { id: 'a', status: 'done', autoResumeAt: null, task: '42 x' },
      { id: 'b', status: 'failed', autoResumeAt: null, task: '42 x' },
      { id: 'c', status: 'waiting', autoResumeAt: null, task: 'Issue 42: y' },
    ]
    expect(activeRunFor(target, runs)?.id).toBe('c')
    expect(activeRunFor(target, runs.slice(0, 2))).toBeNull()
    expect(activeRunFor(target, null)).toBeNull()
  })

  it('pathsOverlap treats a directory as covering its files', () => {
    expect(pathsOverlap('src/a', 'src/a/b.ts')).toBe(true)
    expect(pathsOverlap('src/a', 'src/ab')).toBe(false)
    expect(pathsOverlap('src/a/', 'src/a')).toBe(true)
  })

  it('ownedPathsOf reads the backticked paths of the Owned paths section only', () => {
    const body = [
      '## Summary',
      '`src/nope.ts`',
      '## Owned paths',
      '- `src/a.ts` — edit; `src/__tests__/a.test.ts` — edit',
      '- `e2e/x.spec.ts` (append)',
      '## Verification',
      '`src/other.ts`',
    ].join('\n')
    expect(ownedPathsOf(body)).toEqual([
      'src/a.ts',
      'src/__tests__/a.test.ts',
      'e2e/x.spec.ts',
    ])
    expect(ownedPathsOf('no section')).toEqual([])
  })
})
