// plan.mjs as pure rules (body schemas, the ticket DAG, owned paths per wave) and as an
// idempotent publisher driven against a fake `gh` that remembers issues, links and comments.
import { describe, expect, it } from 'vitest'

import type { Gh, Ticket, TicketPlan } from '../plan.mjs'
import {
  loadPublished,
  parallelPairs,
  publishOrder,
  publishPlan,
  renderTicket,
  savePublished,
  validateBody,
  validateTickets,
} from '../plan.mjs'

const ticket = (over: Partial<Ticket> & { id: string }): Ticket => ({
  title: `Ticket ${over.id}`,
  blockedBy: [],
  ownedPaths: [`src/${over.id}/`],
  estimatedScope: 'S',
  body: {
    summary: 'Do the thing.',
    currentBehaviour: 'Nothing happens.',
    desiredBehaviour: 'The thing happens.',
    fixDirection: 'Add it behind the repository boundary.',
    definitionOfDone: ['It works'],
    tenantIsolationTest: 'None: no tenant-scoped data path.',
    moneyInvariant: 'None: no amount is read, written or rendered.',
    verification: 'pnpm typecheck && pnpm lint && pnpm test',
    outOfScope: 'Everything else.',
  },
  ...over,
})
const plan = (...tickets: Ticket[]): TicketPlan => ({ prd: 100, tickets })

const SPEC = `<!-- schema: spec/v1 -->

<details><summary>Original request</summary>

Please.

</details>

## Problem statement

Trips cannot be shared.

## Goals

- Share a trip by link.

## Non-goals

- Editing by guests.

## Success criteria

- A guest opens the link and sees the trip.

## Constraints

- Tenant isolation (SPEC §6).

## Boundaries

Always: keep the link revocable. Ask first: public indexing. Never: expose other trips.

## Decisions log

- 2026-09-02: links are per trip, not per workspace.

## Open questions

- Should links expire?
`

describe('validateBody', () => {
  it('accepts a spec/v1 with the original request in the preamble', () => {
    expect(validateBody('spec/v1', SPEC)).toEqual([])
  })

  it('names what is missing, empty, unknown or out of order', () => {
    const noMarker = SPEC.replace('<!-- schema: spec/v1 -->', '')
    expect(validateBody('spec/v1', noMarker)).toContain(
      'first line must be <!-- schema: spec/v1 -->',
    )
    const missing = SPEC.replace('## Non-goals\n\n- Editing by guests.\n', '')
    expect(validateBody('spec/v1', missing)).toEqual([
      'missing section "## Non-goals"',
    ])
    const empty = SPEC.replace('- Editing by guests.\n', '')
    expect(validateBody('spec/v1', empty)).toEqual([
      'empty section "## Non-goals"',
    ])
    const unknown = SPEC.replace('## Goals', '## Goal')
    expect(validateBody('spec/v1', unknown)).toEqual([
      'unknown section "## Goal"',
      'missing section "## Goals"',
    ])
    const swapped = SPEC.replace('## Goals', '## Non-goals').replace(
      '## Non-goals\n\n- Editing',
      '## Goals\n\n- Editing',
    )
    expect(validateBody('spec/v1', swapped)[0]).toMatch(/out of order/)
  })

  it('refuses closing keywords anywhere', () => {
    expect(
      validateBody('spec/v1', SPEC.replace('Please.', 'Fixes #12')),
    ).toEqual([
      'closing keyword (Closes #n) is never allowed; the sweeper closes issues',
    ])
  })

  it('lets a PRD through only with no open questions', () => {
    const prd =
      SPEC.replace('spec/v1', 'prd/v1').replace(
        '## Decisions log',
        [
          '## Solution',
          '',
          'A share link.',
          '',
          '## User stories',
          '',
          '1. As a member, I want a link, so that guests can view.',
          '',
          '## Implementation decisions',
          '',
          'Token in D1.',
          '',
          '## Testing decisions',
          '',
          'Repository boundary.',
          '',
          '## Module table',
          '',
          '| concept | owner |\n| --- | --- |\n| share link | server/repos/share |',
          '',
          '## Out of scope',
          '',
          'Editing.',
          '',
          '## Decisions log',
        ].join('\n'),
      ) + '\n## Further notes\n\nNone.\n'
    expect(validateBody('prd/v1', prd)).toEqual([
      'a PRD has no open questions; resolve them or stay at the spec',
    ])
    expect(
      validateBody('prd/v1', prd.replace('- Should links expire?', 'None.')),
    ).toEqual([])
  })

  it('validates what renderTicket writes, including the ticket-only rules', () => {
    expect(
      validateBody('ticket/v2', renderTicket(ticket({ id: 'a' }))),
    ).toEqual([])
    const fat = ticket({
      id: 'a',
      body: {
        ...ticket({ id: 'a' }).body,
        definitionOfDone: ['1', '2', '3', '4'],
      },
    })
    expect(validateBody('ticket/v2', renderTicket(fat))).toEqual([
      'Definition of Done has 4 acceptance criteria; expected 1 to 3',
    ])
    const guarded = ticket({
      id: 'a',
      ownedPaths: ['scripts/agent/x.sh', '../etc'],
    })
    expect(validateBody('ticket/v2', renderTicket(guarded))).toEqual([
      "owned path scripts/agent/x.sh configures the agent; never a ticket's",
      'owned path ../etc must be repo-relative',
    ])
  })
})

describe('validateTickets', () => {
  it('accepts a DAG whose parallel tickets own disjoint paths', () => {
    expect(
      validateTickets(
        plan(
          ticket({ id: 'a', ownedPaths: ['server/repos/share.ts'] }),
          ticket({
            id: 'b',
            blockedBy: ['a'],
            ownedPaths: ['server/repos/share.ts', 'src/routes/'],
          }),
          ticket({
            id: 'c',
            blockedBy: ['a'],
            ownedPaths: ['components/share/'],
          }),
        ),
      ),
    ).toEqual([])
  })

  it('rejects cycles, overlapping parallel paths, closing keywords and XL without wave: solo', () => {
    expect(
      validateTickets(
        plan(
          ticket({ id: 'a', blockedBy: ['b'] }),
          ticket({ id: 'b', blockedBy: ['a'] }),
        ),
      ),
    ).toEqual(['dependency cycle among a, b'])
    expect(
      validateTickets(
        plan(
          ticket({ id: 'a', ownedPaths: ['src/x/'] }),
          ticket({ id: 'b', ownedPaths: ['src/x/y.ts'] }),
        ),
      ),
    ).toEqual(['a and b can run in parallel but both own src/x/ / src/x/y.ts'])
    expect(
      validateTickets(plan(ticket({ id: 'a', title: 'Closes #12 for good' }))),
    ).toEqual(['a: title carries a closing keyword'])
    expect(
      validateTickets(plan(ticket({ id: 'a', estimatedScope: 'XL' }))),
    ).toEqual(['a: XL needs wave: solo (SPEC §8: one concept owns the round)'])
  })

  it('makes a solo ticket own its round', () => {
    const solo = ticket({ id: 'x', estimatedScope: 'XL', wave: 'solo' })
    expect(validateTickets(plan(solo, ticket({ id: 'y' })))).toEqual([
      'x is wave: solo but y can run alongside it; order them',
    ])
    expect(
      validateTickets(plan(solo, ticket({ id: 'y', blockedBy: ['x'] }))),
    ).toEqual([])
  })

  it('reports shape problems per ticket and stops there', () => {
    const errors = validateTickets({
      prd: 0,
      tickets: [
        { id: 'a', blockedBy: ['zzz'], ownedPaths: [], estimatedScope: 'XXL' },
      ],
    })
    expect(errors).toEqual([
      'prd must be the PRD issue number',
      'a: title is required',
      'a: ownedPaths must list at least one path',
      'a: estimatedScope must be one of XS, S, M, L, XL',
      'a: body is required',
    ])
    expect(
      validateTickets(plan(ticket({ id: 'a', blockedBy: ['zzz'] }))),
    ).toEqual(['a: blocked by unknown ticket zzz'])
    expect(validateTickets(null)).toEqual([
      'plan must be an object with a tickets array',
    ])
  })
})

describe('publishOrder / parallelPairs', () => {
  const tickets = [
    ticket({ id: 'c', blockedBy: ['a', 'b'] }),
    ticket({ id: 'b', blockedBy: ['a'] }),
    ticket({ id: 'a' }),
    ticket({ id: 'd' }),
  ]
  it('orders blockers first, keeping input order among the ready', () => {
    expect(publishOrder(tickets)).toEqual(['a', 'd', 'b', 'c'])
  })
  it('pairs only what the graph leaves unordered', () => {
    expect(parallelPairs(tickets)).toEqual([
      ['c', 'd'],
      ['b', 'd'],
      ['a', 'd'],
    ])
  })
})

// A gh that remembers enough GitHub to publish against: issues with labels and blockers,
// sub_issue / blocked_by links (422 on repeat), the PRD's comments.
function fakeGh(opts: { failCreates?: number[] } = {}) {
  const calls: string[][] = []
  const issues = new Map<
    number,
    { labels: Set<string>; blockedBy: Set<number>; body: string }
  >()
  issues.set(100, {
    labels: new Set(['prd', 'status: review']),
    blockedBy: new Set(),
    body: '',
  })
  const comments: Array<{ id: number; body: string }> = []
  const links = new Set<string>()
  let next = 201
  let creates = 0
  let nextComment = 1
  const restId = (n: number) => 1000 + n
  const at = (args: string[], flag: string) =>
    args[args.indexOf(flag) + 1] ?? ''
  const gh: Gh = (args, input) => {
    calls.push(args)
    const [a, b] = args
    if (a === 'issue' && b === 'create') {
      creates++
      if (opts.failCreates?.includes(creates))
        throw Object.assign(new Error('boom'), { stderr: 'network' })
      const n = next++
      issues.set(n, {
        labels: new Set([at(args, '--label')]),
        blockedBy: new Set(),
        body: input ?? '',
      })
      return `https://github.com/design4pro/money-tracker.online/issues/${n}\n`
    }
    if (a === 'issue' && b === 'view') {
      const i = issues.get(Number(args[2]))!
      if (at(args, '--json') === 'labels')
        return JSON.stringify({
          labels: [...i.labels].map((name) => ({ name })),
        })
      return JSON.stringify({
        blockedBy: {
          nodes: [...i.blockedBy].map((number) => ({ number, state: 'OPEN' })),
          totalCount: i.blockedBy.size,
        },
      })
    }
    if (a === 'issue' && b === 'edit') {
      const i = issues.get(Number(args[2]))!
      args.forEach((x, k) => {
        if (x === '--add-label') i.labels.add(args[k + 1])
        if (x === '--remove-label') i.labels.delete(args[k + 1])
      })
      return ''
    }
    if (a === 'api' && b === '--paginate')
      return comments
        .filter((c) => c.body.includes('<!-- agent-tickets -->'))
        .map((c) => JSON.stringify(c))
        .join('\n')
    if (a === 'api' && b === '--method') {
      const [, , method, path, , field] = args
      const value = field.slice(field.indexOf('=') + 1)
      if (method === 'PATCH') {
        comments.find((c) => c.id === Number(path.split('/').pop()))!.body =
          value
        return ''
      }
      if (path.endsWith('/comments')) {
        comments.push({ id: nextComment++, body: value })
        return ''
      }
      const key = `${path}:${field}`
      if (links.has(key))
        throw Object.assign(new Error('HTTP 422'), {
          stderr: 'HTTP 422: Validation Failed',
        })
      links.add(key)
      if (path.endsWith('/blocked_by'))
        issues
          .get(Number(path.split('/')[4]))!
          .blockedBy.add(Number(value) - 1000)
      return ''
    }
    if (a === 'api' && args.at(-1) === '.id')
      return String(restId(Number(b.split('/').pop())))
    throw new Error(`unexpected gh ${args.join(' ')}`)
  }
  return { gh, calls, issues, comments, links }
}

const labels = (f: ReturnType<typeof fakeGh>, n: number) =>
  [...f.issues.get(n)!.labels].sort()
const creates = (f: ReturnType<typeof fakeGh>) =>
  f.calls.filter((c) => c[0] === 'issue' && c[1] === 'create')

describe('publishPlan', () => {
  const three = plan(
    ticket({ id: 'a' }),
    ticket({ id: 'b', blockedBy: ['a'] }),
    ticket({ id: 'c', blockedBy: ['a'], title: 'Ping @claude please' }),
  )

  it('creates queued, links, verifies, then opens the first wave and holds the PRD', () => {
    const f = fakeGh()
    const saved: Array<Record<string, number>> = []
    const result = publishPlan(three, f.gh, {
      onPublished: (m) => saved.push({ ...m }),
    })
    expect(result).toEqual({
      published: { a: 201, b: 202, c: 203 },
      ready: [201],
    })
    expect(saved).toEqual([
      { a: 201 },
      { a: 201, b: 202 },
      { a: 201, b: 202, c: 203 },
    ])
    expect(labels(f, 201)).toEqual(['status: ready'])
    expect(labels(f, 202)).toEqual(['status: queued'])
    expect(labels(f, 100)).toEqual(['prd', 'status: in-progress'])
    expect([...f.issues.get(202)!.blockedBy]).toEqual([201])
    expect([...f.links].filter((l) => l.includes('/sub_issues:'))).toHaveLength(
      3,
    )
    expect(f.issues.get(203)!.body).toContain('<!-- schema: ticket/v2 -->')
    expect(creates(f)[2]).toContain('Ping @​claude please')
  })

  it('resumes after an interrupted create without duplicating anything', () => {
    const f = fakeGh({ failCreates: [2] })
    let published: Record<string, number> = {}
    expect(() =>
      publishPlan(three, f.gh, { onPublished: (m) => (published = { ...m }) }),
    ).toThrow('boom')
    expect(published).toEqual({ a: 201 })
    const again = publishPlan(three, f.gh, {
      published,
      onPublished: (m) => (published = { ...m }),
    })
    expect(again.published).toEqual({ a: 201, b: 202, c: 203 })
    expect(creates(f)).toHaveLength(4) // 1 ok + 1 failed + 2 on the rerun
    expect(f.issues.has(204)).toBe(false)
  })

  it('is a no-op on a second full run (422 on existing links is fine)', () => {
    const f = fakeGh()
    const first = publishPlan(three, f.gh)
    const before = creates(f).length
    const second = publishPlan(three, f.gh, { published: first.published })
    expect(second).toEqual(first)
    expect(creates(f)).toHaveLength(before)
    expect(labels(f, 100)).toEqual(['prd', 'status: in-progress'])
  })

  it('dry-run touches nothing', () => {
    const f = fakeGh()
    const log: string[] = []
    publishPlan(three, f.gh, { dryRun: true, log: (l) => log.push(l) })
    expect(f.calls).toEqual([])
    expect(log).toEqual([
      '+ would create a: Ticket a',
      '+ would create b: Ticket b',
      '+ would create c: Ping @claude please',
    ])
  })
})

describe('loadPublished / savePublished', () => {
  it('keeps the map in one PRD comment and edits it in place', () => {
    const f = fakeGh()
    expect(loadPublished(f.gh, 100)).toEqual({})
    savePublished(f.gh, 100, { a: 201 })
    savePublished(f.gh, 100, { a: 201, b: 202 })
    expect(f.comments).toHaveLength(1)
    expect(loadPublished(f.gh, 100)).toEqual({ a: 201, b: 202 })
  })
})
