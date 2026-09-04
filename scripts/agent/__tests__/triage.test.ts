// cez-triage-claim.sh and triage-apply.sh as black boxes (helpers/gh-world.ts). The claim has two
// doors: the opened path stands down quietly, the run: path refuses out loud. The apply is the
// only writer of a verdict and validates a promoted brief like a planned ticket.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  RUN,
  comments,
  editCalls,
  ghWorld,
  postedComments,
} from './helpers/gh-world'

import type { World } from './helpers/gh-world'

const N = 42
const REPO = '--repo design4pro/money-tracker.online'
const TRIAGED = comments([
  { id: 7, body: '<!-- agent-triage -->\nold verdict' },
])

let w: World
beforeEach(() => {
  w = ghWorld(N)
})

describe('cez-triage-claim.sh', () => {
  const claim = (extra: Record<string, string> = {}) =>
    w.run('cez-triage-claim.sh', [], extra)

  it('claims a fresh status: triage issue on the opened path', () => {
    w.setIssue({ labels: ['type: bug', 'status: triage'] })
    const { status, calls } = claim()
    expect(status).toBe(0)
    expect(editCalls(calls)).toEqual([
      `issue edit ${N} ${REPO} --add-label status: in-progress --remove-label status: triage`,
    ])
    expect(postedComments(calls)[0]).toContain(`agent-claim: ${RUN}`)
    const claimed = JSON.parse(
      readFileSync(join(w.clone, '.agent', 'claim.json'), 'utf8'),
    )
    expect(claimed).toMatchObject({
      issue: N,
      previousStatus: 'status: triage',
      commanded: false,
    })
  })

  it.each([
    [
      'the marker is already there',
      { labels: ['type: bug', 'status: triage'] },
      TRIAGED,
    ],
    [
      'the status is not triage',
      { labels: ['type: bug', 'status: backlog'] },
      {},
    ],
    ['a run holds it', { labels: ['type: bug', 'status: in-progress'] }, {}],
  ])('stands down quietly on the opened path when %s', (_, fixture, extra) => {
    w.setIssue(fixture)
    const { status, calls } = claim(extra)
    expect(status).toBe(1)
    expect(editCalls(calls)).toEqual([])
    expect(postedComments(calls)).toEqual([])
  })

  it('re-triages on run: triage despite the marker and drops the command', () => {
    w.setIssue({ labels: ['type: bug', 'status: needs-info', 'run: triage'] })
    const { status, calls } = claim(TRIAGED)
    expect(status).toBe(0)
    expect(editCalls(calls)).toEqual([
      `issue edit ${N} ${REPO} --add-label status: in-progress --remove-label run: triage --remove-label status: needs-info`,
    ])
    const claimed = JSON.parse(
      readFileSync(join(w.clone, '.agent', 'claim.json'), 'utf8'),
    )
    expect(claimed.commanded).toBe(true)
  })

  it.each([
    [
      'a PRD',
      { labels: ['prd', 'status: in-progress', 'run: triage'], subIssues: 3 },
      'has sub-issues',
    ],
    [
      'an issue another run holds',
      { labels: ['type: bug', 'status: in-progress', 'run: triage'] },
      'in progress',
    ],
    [
      'an issue in review',
      { labels: ['type: bug', 'status: review', 'run: triage'] },
      'status: review',
    ],
  ])(
    'refuses run: triage on %s: drops the label and comments',
    (_, fixture, reason) => {
      w.setIssue(fixture)
      const { status, calls } = claim()
      expect(status).toBe(1)
      expect(editCalls(calls)).toEqual([
        `issue edit ${N} ${REPO} --remove-label run: triage`,
      ])
      expect(postedComments(calls)[0]).toContain('agent-result: refused')
      expect(postedComments(calls)[0]).toContain(reason)
    },
  )
})

const BRIEF = `<!-- schema: ticket/v2 -->

Scope: S

## Summary

The list drops the last trip.

## Current behaviour

\`listTrips\` slices one short; reproduced by the test below.

## Desired behaviour

Every trip of the organisation is listed.

## Fix direction

Off-by-one in the slice; SPEC §6 settles the repository as the owner.

## Definition of Done

- [ ] the reproduction test passes

## Owned paths

- \`src/server/repos/transactions.ts\`

## Tenant isolation test

n/a

## Money invariant

n/a

## Verification

pnpm typecheck && pnpm lint && pnpm test

## Out of scope

Pagination.
`

describe('triage-apply.sh', () => {
  const stage = (verdict: string, brief?: string) => {
    w.agentFile(
      'triage.json',
      JSON.stringify({ verdict, reason: `because ${verdict}` }),
    )
    w.agentFile('triage/notes.md', '**Reproduction:** cez-test.sh said so.\n')
    if (brief !== undefined) w.agentFile('triage/brief.md', brief)
  }
  const apply = (args: string[] = [], extra: Record<string, string> = {}) =>
    w.run('triage-apply.sh', args, extra)

  it('promotes: brief into the body with the original kept, notes as the comment, status ready', () => {
    w.setIssue({
      labels: ['type: bug', 'status: in-progress'],
      body: 'the report',
    })
    stage('promoted', BRIEF)
    const { status, calls, body } = apply()
    expect(status).toBe(0)
    expect(body).toMatch(/^<!-- schema: ticket\/v2 -->\n/)
    expect(body).toContain('<details><summary>Original request</summary>')
    expect(body).toContain('the report')
    expect(body).toContain('## Owned paths')
    const note = postedComments(calls)[0]
    expect(note).toContain('agent-triage')
    expect(note).toContain('generated by AI during triage')
    expect(note).toContain('`promoted` → `status: ready`')
    expect(note).toContain('cez-test.sh said so')
    expect(note).toContain('Promoted automatically')
    expect(editCalls(calls)).toEqual([
      `issue edit ${N} ${REPO} --body-file -`,
      `issue edit ${N} ${REPO} --add-label status: ready --remove-label status: in-progress`,
    ])
  })

  it.each([
    ['a feature', { labels: ['type: feature', 'status: in-progress'] }, BRIEF],
    ['no brief', { labels: ['type: bug', 'status: in-progress'] }, undefined],
    [
      'a brief missing a section',
      { labels: ['type: bug', 'status: in-progress'] },
      BRIEF.replace('## Out of scope\n\nPagination.\n', ''),
    ],
  ])('refuses to promote %s and writes nothing', (_, fixture, brief) => {
    w.setIssue(fixture)
    stage('promoted', brief)
    const { status, calls, body } = apply()
    expect(status).toBe(1)
    expect(body).toBeNull()
    expect(editCalls(calls)).toEqual([])
    expect(postedComments(calls)).toEqual([])
  })

  it.each([
    ['needs-info', 'status: needs-info'],
    ['needs-plan', 'status: backlog'],
    ['needs-human', 'status: needs-human'],
    ['refuted', 'status: needs-human'],
    ['redundant', 'status: needs-human'],
  ])('%s → %s without touching the body', (verdict, target) => {
    w.setIssue({ labels: ['type: enhancement', 'status: in-progress'] })
    stage(verdict)
    const { status, calls, body } = apply()
    expect(status).toBe(0)
    expect(body).toBeNull()
    expect(postedComments(calls)[0]).toContain(`\`${verdict}\` → \`${target}\``)
    expect(postedComments(calls)[0]).toContain(
      'Add `run: triage` to triage again',
    )
    expect(editCalls(calls)).toEqual([
      `issue edit ${N} ${REPO} --add-label ${target} --remove-label status: in-progress`,
    ])
  })

  it('--check validates and names the target without writing', () => {
    w.setIssue({ labels: ['type: bug', 'status: in-progress'] })
    stage('promoted', BRIEF)
    const { status, calls, body } = apply(['--check'])
    expect(status).toBe(0)
    expect(body).toBeNull()
    expect(editCalls(calls)).toEqual([])
    expect(postedComments(calls)).toEqual([])
  })

  it('edits an existing agent-triage comment in place on a repeat', () => {
    w.setIssue({ labels: ['type: bug', 'status: in-progress'] })
    stage('needs-info')
    const { status, calls } = apply([], TRIAGED)
    expect(status).toBe(0)
    expect(postedComments(calls)).toEqual([])
    expect(
      calls.some((c) =>
        c.startsWith(
          `api --method PATCH repos/design4pro/money-tracker.online/issues/comments/7`,
        ),
      ),
    ).toBe(true)
  })
})
