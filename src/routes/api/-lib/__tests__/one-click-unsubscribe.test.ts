/**
 * `POST /api/unsubscribe` against the real generated DDL.
 *
 * The route module imports `cloudflare:workers`, which `vitest.config.ts` forbids in this project,
 * so the cases run `oneClickUnsubscribe` with the dependencies the route would build. What a link
 * turns off field by field is `src/server/email/__tests__/unsubscribe.test.ts`; this file is about
 * the HTTP answer and whether a write happened.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  UNSUBSCRIBE_TOKEN_MAX_LENGTH,
  signUnsubscribeToken,
} from '#/server/email/unsubscribe-token'
import { createLogger, createMemorySink } from '#/server/observability/logger'
import { listPrefsFor } from '#/server/repos/notifications'
import {
  NOW,
  createBudgetWorld,
  executed,
} from '#/server/repos/__tests__/budget-harness'

import { oneClickUnsubscribe } from '../one-click-unsubscribe'

import type { UnsubscribeKeys } from '#/server/email/unsubscribe-token'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

const KEYS: UnsubscribeKeys = { current: 'test-signing-key' }

let world: BudgetWorld
let sink: ReturnType<typeof createMemorySink>

beforeEach(async () => {
  world = await createBudgetWorld()
  sink = createMemorySink()
})

function post(query: string): Request {
  return new Request(`https://money-tracker.test/api/unsubscribe${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  })
}

function run(request: Request, keys: UnsubscribeKeys | null = KEYS) {
  return oneClickUnsubscribe(request, {
    db: world.db,
    keys,
    logger: createLogger({ level: 'debug', sink }),
    now: NOW,
  })
}

function goodToken() {
  return signUnsubscribeToken(
    {
      userId: 'user-a',
      organizationId: 'org-a',
      subject: 'budget.exceeded',
    },
    KEYS.current,
    NOW,
  )
}

function writes() {
  return executed.filter(
    (statement) => !statement.trimStart().startsWith('select'),
  )
}

async function expectRefused(response: Response) {
  expect(response.status).toBe(400)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('location')).toBeNull()
  expect(await response.text()).toBe('')
}

describe('POST /api/unsubscribe', () => {
  it('answers 200 with no body and turns the email off', async () => {
    const response = await run(post(`?t=${await goodToken()}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).toBe('')
    const prefs = await listPrefsFor(world.scope, 'user-a')
    expect(prefs.get('budget.exceeded')?.email).toBe(false)
  })

  it('is idempotent: a second POST is 200 and writes nothing', async () => {
    const request = `?t=${await goodToken()}`
    await run(post(request))
    const after = await listPrefsFor(world.scope, 'user-a')
    executed.length = 0

    const again = await run(post(request))

    expect(again.status).toBe(200)
    expect(writes()).toEqual([])
    expect(await listPrefsFor(world.scope, 'user-a')).toEqual(after)
  })

  it('answers 400 with no body for a tampered token and writes nothing', async () => {
    const token = await goodToken()
    const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`
    executed.length = 0

    await expectRefused(await run(post(`?t=${tampered}`)))
    expect(writes()).toEqual([])
  })

  it('answers 400 for an expired token', async () => {
    const signedLongAgo = await signUnsubscribeToken(
      {
        userId: 'user-a',
        organizationId: 'org-a',
        subject: 'budget.exceeded',
      },
      KEYS.current,
      new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000),
    )

    await expectRefused(await run(post(`?t=${signedLongAgo}`)))
  })

  it.each([
    ['a missing t', ''],
    ['an empty t', '?t='],
    ['an oversized t', `?t=${'a'.repeat(UNSUBSCRIBE_TOKEN_MAX_LENGTH + 1)}`],
  ])('answers 400 for %s', async (_, query) => {
    await expectRefused(await run(post(query)))
  })

  it('answers 400 and warns when the signing secret is unset', async () => {
    executed.length = 0

    await expectRefused(await run(post(`?t=${await goodToken()}`), null))

    expect(writes()).toEqual([])
    expect(sink.records).toMatchObject([
      {
        level: 'warn',
        msg: expect.stringContaining('UNSUBSCRIBE_TOKEN_SECRET is unset'),
      },
    ])
  })
})
