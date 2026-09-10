/**
 * The fan-out, and the asymmetry in how the three adapters treat a failure.
 *
 * One crossing is one notification per member, and the counting is what these check: a household of
 * two gets two rows, the membership list is read once for a batch rather than once per pair, and
 * the two cron adapters escalate a failure while the goals adapter — which runs inside a request
 * that has already saved something — never does.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { crossingMarkerKey } from '#/server/budgets/thresholds'
import {
  addSecondMember,
  createBudgetWorld,
  executed as harnessExecuted,
} from '#/server/repos/__tests__/budget-harness'
import { countUnread, pageForReader } from '#/server/repos/notifications'

import {
  notifyBudgetAlerts,
  notifyGoalReached,
  notifyRecurringReminders,
} from '../adapters'
import { setNotificationEmailEnqueuer } from '../email'

import type { ThresholdCrossing } from '#/server/budgets/thresholds'
import type { DueReminder } from '#/server/recurring/reminders'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type { NotificationEmailArgs } from '../email'
import type { Minor } from '#/lib/money'

let world: BudgetWorld
let enqueued: Array<NotificationEmailArgs>

function crossing(over: Partial<ThresholdCrossing> = {}): ThresholdCrossing {
  return {
    budgetId: 'budget-1',
    budgetName: 'Groceries',
    periodStart: '2026-03-01',
    threshold: 80,
    spentMinor: 160_000 as Minor,
    availableMinor: 200_000 as Minor,
    currencyCode: 'PLN',
    event: 'budget.threshold_crossed',
    ...over,
  }
}

function reminder(over: Partial<DueReminder> = {}): DueReminder {
  return {
    seriesId: 'series-1',
    seriesName: 'Rent',
    periodStart: '2026-03-01',
    dueOn: '2026-03-18',
    offset: '3d',
    event: 'recurring.due_soon',
    expectedAmountMinor: 250_000,
    expectedCurrencyCode: 'PLN',
    notifyEmail: true,
    ...over,
  }
}

beforeEach(async () => {
  world = await createBudgetWorld()
  enqueued = []
  setNotificationEmailEnqueuer(async (_scope, args) => {
    enqueued.push(args)
  })
})

afterEach(() => {
  setNotificationEmailEnqueuer(null)
})

describe('the fan-out', () => {
  it('gives every member of a household their own row for one crossing', async () => {
    await addSecondMember(world.db)

    await notifyBudgetAlerts(world.scope, [crossing()])

    // Two rows, one each — and each is that person's own, so `countUnread` reads one per scope.
    expect(await countUnread(world.scope)).toBe(1)
    const bInA = {
      ...world.scope,
      ctx: { ...world.scope.ctx, userId: 'user-b' },
    }
    expect(await countUnread(bInA)).toBe(1)
  })

  it('reuses the producer’s own dedupe key, so the marker and the row agree', async () => {
    const one = crossing()
    await notifyBudgetAlerts(world.scope, [one])

    const rows = (await pageForReader(world.scope)).items
    expect(rows[0].dedupeKey).toBe(crossingMarkerKey(one))
  })

  it('reads the membership list once for a whole batch', async () => {
    await addSecondMember(world.db)
    harnessExecuted.length = 0

    await notifyBudgetAlerts(world.scope, [
      crossing({ threshold: 50 }),
      crossing({ threshold: 80 }),
      crossing({ threshold: 90 }),
    ])

    // The joined list is the expensive read. `notify`'s own per-recipient `isMember` is a separate,
    // indexed one — this asserts the list is not rebuilt three times.
    const listReads = harnessExecuted.filter(
      (statement) =>
        statement.includes('from "member"') && statement.includes('inner join'),
    )
    expect(listReads).toHaveLength(1)
  })

  it('does nothing at all for an empty batch', async () => {
    harnessExecuted.length = 0
    await notifyBudgetAlerts(world.scope, [])
    await notifyRecurringReminders(world.scope, [])

    expect(harnessExecuted).toEqual([])
  })
})

describe('the budget payload', () => {
  it('adds overspentMinor for an exceeded envelope and omits it below the line', async () => {
    await notifyBudgetAlerts(world.scope, [
      crossing({ threshold: 80 }),
      crossing({
        threshold: 100,
        event: 'budget.exceeded',
        spentMinor: 205_000 as Minor,
      }),
    ])

    const rows = (await pageForReader(world.scope)).items
    const byKind = new Map(
      rows.map((row) => [
        row.kind,
        JSON.parse(row.payloadJson) as Record<string, unknown>,
      ]),
    )

    expect(byKind.get('budget.threshold_crossed')).not.toHaveProperty(
      'overspentMinor',
    )
    // 205 000 − 200 000, as a positive magnitude.
    expect(byKind.get('budget.exceeded')?.overspentMinor).toBe(5_000)
  })
})

describe('the recurring adapter', () => {
  it('passes a series with notifyEmail off through as a suppression', async () => {
    await notifyRecurringReminders(world.scope, [
      reminder({ event: 'recurring.overdue', notifyEmail: false }),
    ])

    // The row still lands — the series opted out of *email*, not out of being told.
    expect(await countUnread(world.scope)).toBe(1)
    expect(enqueued).toEqual([])
  })

  it('emails an immediate reminder when the series wants it', async () => {
    await notifyRecurringReminders(world.scope, [
      reminder({ event: 'recurring.overdue', notifyEmail: true }),
    ])

    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].kind).toBe('recurring.overdue')
  })
})

describe('escalation', () => {
  /** A scope whose database refuses everything: even the membership list cannot be read. */
  function brokenScope() {
    return {
      ...world.scope,
      db: {
        select: () => {
          throw new Error('D1 is unreachable')
        },
      },
    } as unknown as typeof world.scope
  }

  /**
   * A scope that answers the membership list and then refuses, which is what one broken dispatch
   * among healthy ones looks like: `listMembers` succeeds, every `notify` after it returns
   * `'failed'`, and it is `escalate` rather than a raw driver error that reaches the cron.
   */
  function failsAfterMembers() {
    let answered = 0
    return {
      ...world.scope,
      db: {
        ...world.scope.db,
        select: (...columns: Array<unknown>) => {
          answered += 1
          if (answered > 1) throw new Error('D1 is unreachable')
          return (
            world.scope.db.select as (...args: Array<unknown>) => unknown
          )(...columns)
        },
      },
    } as unknown as typeof world.scope
  }

  it('throws the escalation, naming the kind and the count', async () => {
    let message = ''
    try {
      await notifyBudgetAlerts(failsAfterMembers(), [crossing()])
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/notification dispatch/)
    expect(message).toContain('budget.threshold_crossed')
    // Who did not get told is not a fact a log line needs in order to say something is broken.
    expect(message).not.toContain('user-a')
  })

  it('lets a membership read that itself fails reach the cron as it is', async () => {
    // Not wrapped into an escalation: nothing was dispatched, so there is no count to report, and
    // the driver's own message is the more useful one in the sweep's log.
    await expect(
      notifyBudgetAlerts(brokenScope(), [crossing()]),
    ).rejects.toThrow('D1 is unreachable')
  })

  it('does not make the goals adapter throw, even when listMembers itself fails', async () => {
    // The contribution has already committed. A notification that cannot be written must not come
    // back to the person as an error about their money.
    await expect(
      notifyGoalReached(brokenScope(), {
        goalId: 'goal-1',
        name: 'New bike',
        targetMinor: 400_000 as Minor,
        contributedMinor: 400_000 as Minor,
        currencyCode: 'PLN',
        transactionId: 'txn-1',
      }),
    ).resolves.toBeUndefined()
  })

  it('still writes the goal row when nothing is broken', async () => {
    await notifyGoalReached(world.scope, {
      goalId: 'goal-1',
      name: 'New bike',
      targetMinor: 400_000 as Minor,
      contributedMinor: 400_000 as Minor,
      currencyCode: 'PLN',
      transactionId: 'txn-1',
    })

    expect(await countUnread(world.scope)).toBe(1)
    expect((await pageForReader(world.scope)).items[0].dedupeKey).toBe(
      'goal:reached:v1:goal-1',
    )
  })
})
