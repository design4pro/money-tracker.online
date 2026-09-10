/**
 * What `notify()` promises, against a real database.
 *
 * The interesting claims are all about what it does *not* do: it does not throw at a caller whose
 * write has already committed, it does not write a row addressed to somebody who left, it does not
 * let a producer widen a preference, and it does not tell the same person the same thing twice
 * however many times a cron re-offers it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  addSecondMember,
  createBudgetWorld,
} from '#/server/repos/__tests__/budget-harness'
import {
  countUnread,
  pageForReader,
  upsertPref,
} from '#/server/repos/notifications'

import { setNotificationEmailEnqueuer } from '../email'
import { notify } from '../dispatch'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type { NotificationEmailArgs } from '../email'

const AT = new Date('2026-03-15T10:00:00.000Z')

/** Digestible, so its email leg waits for `21-S2` — the default this stage exercises most. */
const DIGESTIBLE = 'budget.threshold_crossed' as const
/** Immediate, so its email leg runs now. */
const IMMEDIATE = 'budget.exceeded' as const

const thresholdPayload = {
  v: 1,
  budgetId: 'budget-1',
  budgetName: 'Groceries',
  periodStart: '2026-03-01',
  threshold: 80,
  spentMinor: 160_000,
  availableMinor: 200_000,
  currencyCode: 'PLN',
} as const

const exceededPayload = { ...thresholdPayload, overspentMinor: 5_000 } as const

let world: BudgetWorld
let enqueued: Array<NotificationEmailArgs>

beforeEach(async () => {
  world = await createBudgetWorld()
  enqueued = []
  setNotificationEmailEnqueuer(async (_scope, args) => {
    enqueued.push(args)
  })
})

afterEach(() => {
  // The module is shared across suites; the neighbours assert the no-op is still the default.
  setNotificationEmailEnqueuer(null)
})

describe('the dedupe key', () => {
  it('leaves one row however many times the same occasion is offered', async () => {
    const outcomes = []
    for (let attempt = 0; attempt < 100; attempt += 1) {
      outcomes.push(
        await notify(
          world.scope,
          {
            userId: 'user-a',
            kind: DIGESTIBLE,
            payload: thresholdPayload,
            dedupeKey: 'budget:threshold:v1:budget-1:2026-03-01:80',
          },
          AT,
        ),
      )
    }

    expect(outcomes[0]).toBe('written')
    expect(new Set(outcomes.slice(1))).toStrictEqual(new Set(['deduped']))
    expect(await countUnread(world.scope)).toBe(1)
  })
})

describe('the membership check', () => {
  it('writes nothing for a userId who is not a member', async () => {
    const outcome = await notify(
      world.scope,
      {
        userId: 'user-b',
        kind: DIGESTIBLE,
        payload: thresholdPayload,
        dedupeKey: 'k',
      },
      AT,
    )

    expect(outcome).toBe('skipped')
    expect(await countUnread(world.scope)).toBe(0)
  })

  it('writes for somebody who joined the workspace', async () => {
    await addSecondMember(world.db)

    expect(
      await notify(
        world.scope,
        {
          userId: 'user-b',
          kind: DIGESTIBLE,
          payload: thresholdPayload,
          dedupeKey: 'k',
        },
        AT,
      ),
    ).toBe('written')
  })
})

describe('preference resolution', () => {
  it('uses the kind’s defaults when the person has said nothing', async () => {
    expect(
      await notify(
        world.scope,
        {
          userId: 'user-a',
          kind: DIGESTIBLE,
          payload: thresholdPayload,
          dedupeKey: 'k',
        },
        AT,
      ),
    ).toBe('written')
    expect(await countUnread(world.scope)).toBe(1)
  })

  it('writes nothing once the person has turned every channel off', async () => {
    await upsertPref(
      world.scope,
      { kind: DIGESTIBLE, inApp: false, email: false, digest: false },
      AT,
    )

    expect(
      await notify(
        world.scope,
        {
          userId: 'user-a',
          kind: DIGESTIBLE,
          payload: thresholdPayload,
          dedupeKey: 'k',
        },
        AT,
      ),
    ).toBe('skipped')
    expect(await countUnread(world.scope)).toBe(0)
  })

  it('still writes the row when only in-app is off, because the email is about it', async () => {
    await upsertPref(
      world.scope,
      { kind: IMMEDIATE, inApp: false, email: true, digest: false },
      AT,
    )

    expect(
      await notify(
        world.scope,
        {
          userId: 'user-a',
          kind: IMMEDIATE,
          payload: exceededPayload,
          dedupeKey: 'k',
        },
        AT,
      ),
    ).toBe('written')

    const rows = (await pageForReader(world.scope)).items
    expect(rows).toHaveLength(1)
    expect(enqueued).toHaveLength(1)
    // The seam is handed the row's own id, not the dedupe key: `21-S2` links to a notification.
    expect(enqueued[0].notificationId).toBe(rows[0].id)
  })

  it('is read per person, so one member’s answer is not the other’s', async () => {
    await addSecondMember(world.db)
    await upsertPref(
      world.scope,
      { kind: DIGESTIBLE, inApp: false, email: false, digest: false },
      AT,
    )

    expect(
      await notify(
        world.scope,
        {
          userId: 'user-a',
          kind: DIGESTIBLE,
          payload: thresholdPayload,
          dedupeKey: 'k',
        },
        AT,
      ),
    ).toBe('skipped')
    expect(
      await notify(
        world.scope,
        {
          userId: 'user-b',
          kind: DIGESTIBLE,
          payload: thresholdPayload,
          dedupeKey: 'k',
        },
        AT,
      ),
    ).toBe('written')
  })
})

describe('the email leg', () => {
  it('runs for an immediate kind and not for a digestible one', async () => {
    await notify(
      world.scope,
      {
        userId: 'user-a',
        kind: DIGESTIBLE,
        payload: thresholdPayload,
        dedupeKey: 'digestible',
      },
      AT,
    )
    expect(enqueued).toEqual([])

    await notify(
      world.scope,
      {
        userId: 'user-a',
        kind: IMMEDIATE,
        payload: exceededPayload,
        dedupeKey: 'immediate',
      },
      AT,
    )
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].kind).toBe(IMMEDIATE)
  })

  it('leaves the row written and reports success when the seam throws', async () => {
    setNotificationEmailEnqueuer(async () => {
      throw new Error('the queue is unreachable')
    })

    const outcome = await notify(
      world.scope,
      {
        userId: 'user-a',
        kind: IMMEDIATE,
        payload: exceededPayload,
        dedupeKey: 'k',
      },
      AT,
    )

    // Not `'failed'`: the row is committed, and a cron told to escalate would retry forever into a
    // dedupe key that is already taken.
    expect(outcome).toBe('written')
    expect(await countUnread(world.scope)).toBe(1)
  })

  it('is suppressed by suppressEmail, and the row still lands', async () => {
    const outcome = await notify(
      world.scope,
      {
        userId: 'user-a',
        kind: IMMEDIATE,
        payload: exceededPayload,
        dedupeKey: 'k',
        suppressEmail: true,
      },
      AT,
    )

    expect(outcome).toBe('written')
    expect(enqueued).toEqual([])
    expect(await countUnread(world.scope)).toBe(1)
  })

  it('cannot be enabled by suppressEmail: false when the preference says no', async () => {
    await upsertPref(
      world.scope,
      { kind: IMMEDIATE, inApp: true, email: false, digest: false },
      AT,
    )

    expect(
      await notify(
        world.scope,
        {
          userId: 'user-a',
          kind: IMMEDIATE,
          payload: exceededPayload,
          dedupeKey: 'k',
          suppressEmail: false,
        },
        AT,
      ),
    ).toBe('written')
    // The lever is one-way. `false` is "I am not suppressing", never "send it anyway".
    expect(enqueued).toEqual([])
  })
})

describe('notify never throws at its caller', () => {
  it('returns failed and logs when the database is gone', async () => {
    const broken = {
      ...world.scope,
      db: {
        select: () => {
          throw new Error('D1 is unreachable')
        },
      },
    } as unknown as typeof world.scope

    const outcome = await notify(
      broken,
      {
        userId: 'user-a',
        kind: DIGESTIBLE,
        payload: thresholdPayload,
        dedupeKey: 'k',
      },
      AT,
    )

    expect(outcome).toBe('failed')
  })
})
