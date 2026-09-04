// cez-claim.sh as a black box (helpers/gh-world.ts): every refusal drops `run: implement` and
// comments `refused`; a claim is one label edit plus the claim comment; adoption is conservative.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { RUN, editCalls, ghWorld, postedComments } from './helpers/gh-world'

import type { World } from './helpers/gh-world'

const N = 42
let w: World
beforeEach(() => {
  w = ghWorld(N)
})
const claim = (extra: Record<string, string> = {}) =>
  w.run('cez-claim.sh', [], extra)

describe('cez-claim.sh preflight', () => {
  it.each([
    ['a closed issue', { state: 'CLOSED' }, 'is not open'],
    [
      'a queued ticket with an open blocker',
      {
        labels: ['run: implement', 'status: queued'],
        blockedBy: [{ number: 5, state: 'OPEN' }],
      },
      'status: queued',
    ],
    [
      'a ready ticket with an open blocker',
      { blockedBy: [{ number: 5, state: 'OPEN' }] },
      'blocked by open #5',
    ],
    [
      'a PRD',
      { labels: ['run: implement', 'status: ready', 'prd'], subIssues: 3 },
      'is a PRD',
    ],
    ['a non-leaf', { subIssues: 2 }, 'has sub-issues'],
  ])('refuses %s: drops run: implement and comments', (_, fixture, reason) => {
    w.setIssue(fixture)
    const { status, calls } = claim()
    expect(status).toBe(1)
    expect(editCalls(calls)).toEqual([
      `issue edit ${N} --repo design4pro/money-tracker.online --remove-label run: implement`,
    ])
    expect(postedComments(calls)).toHaveLength(1)
    expect(postedComments(calls)[0]).toContain('agent-result: refused')
    expect(postedComments(calls)[0]).toContain(reason)
    expect(existsSync(join(w.clone, '.agent', 'claim.json'))).toBe(false)
  })

  it('refuses without a run: label and removes nothing', () => {
    w.setIssue({ labels: ['status: ready'] })
    const { status, calls } = claim()
    expect(status).toBe(1)
    expect(editCalls(calls)).toEqual([])
    expect(postedComments(calls)[0]).toContain('carries no `run: implement`')
  })

  it('refuses when an agent PR is already open for the ticket', () => {
    w.setIssue({})
    const { status, calls } = claim({
      FAKE_PRS: JSON.stringify([
        { number: 77, headRefName: `claude/issue-${N}-abcd1234` },
      ]),
    })
    expect(status).toBe(1)
    expect(postedComments(calls)[0]).toContain('open agent PR (#77)')
  })

  it('ignores an open PR whose branch names a longer issue number', () => {
    w.setIssue({})
    const { status } = claim({
      FAKE_PRS: JSON.stringify([
        { number: 78, headRefName: `claude/issue-${N}0-ffff0000` },
      ]),
    })
    expect(status).toBe(0)
  })

  it('leaves the issue alone while another run holds its lock', () => {
    w.setIssue({})
    // The lock is a directory with the holder's pid inside; vitest's own pid is alive.
    const lock = join(
      w.clone,
      '.ai',
      'cezar',
      'tmp',
      'locks',
      `issue-${N}.lock`,
    )
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'pid'), String(process.pid))
    const { status, calls } = claim()
    expect(status).toBe(1)
    expect(calls).toEqual([])
  })
})

describe('cez-claim.sh claim', () => {
  it('swaps the status and drops run: implement in one edit, then writes the claim comment', () => {
    w.setIssue({ labels: ['run: implement', 'status: needs-human'] })
    const { status, calls } = claim()
    expect(status).toBe(0)
    expect(editCalls(calls)).toEqual([
      `issue edit ${N} --repo design4pro/money-tracker.online --add-label status: in-progress --remove-label run: implement --remove-label status: needs-human`,
    ])
    expect(postedComments(calls)[0]).toContain(`agent-claim: ${RUN}`)
    expect(postedComments(calls)[0]).toContain('agent-heartbeat:')
    const claimed = JSON.parse(
      readFileSync(join(w.clone, '.agent', 'claim.json'), 'utf8'),
    )
    expect(claimed).toMatchObject({
      issue: N,
      run: RUN,
      previousStatus: 'status: needs-human',
      adopted: null,
    })
    expect(
      existsSync(
        join(w.clone, '.ai', 'cezar', 'tmp', 'locks', `issue-${N}.lock`),
      ),
    ).toBe(false)
  })

  it('adopts a clean orphan branch and skips one that touches a protected path', () => {
    w.setIssue({})
    w.pushOrphan(`claude/issue-${N}-dead0001`, 'src/orphan.ts')
    w.pushOrphan(`claude/issue-${N}-dead0002`, 'scripts/agent/evil.sh')
    const { status } = claim()
    expect(status).toBe(0)
    const claimed = JSON.parse(
      readFileSync(join(w.clone, '.agent', 'claim.json'), 'utf8'),
    )
    expect(claimed.adopted).toBe(`origin/claude/issue-${N}-dead0001`)
    expect(existsSync(join(w.clone, 'src', 'orphan.ts'))).toBe(true)
    expect(existsSync(join(w.clone, 'scripts', 'agent', 'evil.sh'))).toBe(false)
  })

  it('does not adopt a branch that conflicts with develop', () => {
    w.setIssue({})
    w.pushOrphan(`claude/issue-${N}-dead0003`, 'README.md')
    writeFileSync(join(w.clone, 'README.md'), 'develop moved on\n')
    w.git(['commit', '-q', '-am', 'develop moves'])
    w.git(['push', '-q', 'origin', 'develop'])
    const { status } = claim()
    expect(status).toBe(0)
    const claimed = JSON.parse(
      readFileSync(join(w.clone, '.agent', 'claim.json'), 'utf8'),
    )
    expect(claimed.adopted).toBeNull()
    expect(readFileSync(join(w.clone, 'README.md'), 'utf8')).toBe(
      'develop moved on\n',
    )
  })
})
