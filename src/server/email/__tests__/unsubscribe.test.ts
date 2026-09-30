/**
 * Reading and applying an unsubscribe link against the real generated DDL.
 *
 * The preference write is the load-bearing part: `upsertPref` replaces the whole channel triple, so
 * each case checks the fields the link must **not** change as well as the one it must.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { member } from '#/server/db/auth-schema'
import { listPrefsFor, upsertPref } from '#/server/repos/notifications'
import {
  NOW,
  addSecondMember,
  createBudgetWorld,
  executed,
} from '#/server/repos/__tests__/budget-harness'

import { applyUnsubscribe, readUnsubscribe } from '../unsubscribe'
import { signUnsubscribeToken } from '../unsubscribe-token'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type { UnsubscribeSubject } from '../unsubscribe-token'

const KEYS = { current: 'test-signing-key' }
const LATER = new Date(NOW.getTime() + 60_000)

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
})

function tokenFor(
  subject: UnsubscribeSubject,
  userId = 'user-a',
  organizationId = 'org-a',
) {
  return signUnsubscribeToken(
    { userId, organizationId, subject },
    KEYS.current,
    NOW,
  )
}

async function prefsOfA() {
  return listPrefsFor(world.scope, 'user-a')
}

describe('readUnsubscribe', () => {
  it('names the subject and the workspace, and writes nothing', async () => {
    const token = await tokenFor('budget.exceeded')
    executed.length = 0

    await expect(readUnsubscribe(world.db, KEYS, token, NOW)).resolves.toEqual({
      ok: true,
      subject: 'budget.exceeded',
      workspaceName: 'A',
    })
    expect(
      executed.filter(
        (statement) => !statement.trimStart().startsWith('select'),
      ),
    ).toEqual([])
    expect((await prefsOfA()).size).toBe(0)
  })
})

describe('applyUnsubscribe', () => {
  it('turns email off for one kind and leaves in-app and the digest as they were', async () => {
    await upsertPref(
      world.scope,
      {
        kind: 'budget.threshold_crossed',
        inApp: false,
        email: true,
        digest: true,
      },
      NOW,
    )

    const outcome = await applyUnsubscribe(
      world.db,
      KEYS,
      await tokenFor('budget.threshold_crossed'),
      LATER,
    )

    expect(outcome).toEqual({
      ok: true,
      subject: 'budget.threshold_crossed',
      workspaceName: 'A',
    })
    const prefs = await prefsOfA()
    expect(prefs.size).toBe(1)
    expect(prefs.get('budget.threshold_crossed')).toMatchObject({
      inApp: false,
      email: false,
      digest: true,
    })
  })

  it('writes a kind with no stored row from its defaults, changing only email', async () => {
    await applyUnsubscribe(
      world.db,
      KEYS,
      await tokenFor('budget.exceeded'),
      LATER,
    )

    expect((await prefsOfA()).get('budget.exceeded')).toMatchObject({
      inApp: true,
      email: false,
      digest: false,
    })
  })

  it('turns the daily summary off for every digestible kind and touches no immediate one', async () => {
    await applyUnsubscribe(world.db, KEYS, await tokenFor('digest'), LATER)

    const prefs = await prefsOfA()
    expect([...prefs.keys()].sort()).toEqual([
      'budget.threshold_crossed',
      'goal.reached',
      'recurring.due_soon',
    ])
    for (const row of prefs.values()) {
      expect(row).toMatchObject({ inApp: true, email: true, digest: false })
    }
  })

  it('changes nothing the second time, not even updated_at', async () => {
    const token = await tokenFor('digest')
    await applyUnsubscribe(world.db, KEYS, token, LATER)
    const first = await prefsOfA()

    const again = await applyUnsubscribe(
      world.db,
      KEYS,
      token,
      new Date(LATER.getTime() + 60_000),
    )

    expect(again.ok).toBe(true)
    expect(await prefsOfA()).toEqual(first)
  })

  it('is invalid for a person who has left the workspace', async () => {
    await addSecondMember(world.db)
    const token = await tokenFor('budget.exceeded', 'user-b', 'org-a')
    await world.db.delete(member).where(eq(member.id, 'mem-a2'))

    await expect(readUnsubscribe(world.db, KEYS, token, NOW)).resolves.toEqual({
      ok: false,
    })
    await expect(applyUnsubscribe(world.db, KEYS, token, NOW)).resolves.toEqual(
      {
        ok: false,
      },
    )
  })

  it('is invalid, and writes nothing, without a signing key or with a bad token', async () => {
    const token = await tokenFor('budget.exceeded')

    for (const [keys, candidate] of [
      [null, token],
      [KEYS, `${token}x`],
      [{ current: 'rotated-without-previous' }, token],
    ] as const) {
      await expect(
        applyUnsubscribe(world.db, keys, candidate, NOW),
      ).resolves.toEqual({
        ok: false,
      })
    }
    expect((await prefsOfA()).size).toBe(0)
  })
})
