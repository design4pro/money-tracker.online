/**
 * When a series says something, and what it says.
 *
 * `dueReminders` is pure - subjects and a day in, reminders out - so every case is two dates and
 * no mock of a clock. Three rules are checked, and each is a decision somebody would notice if it
 * went the other way:
 *
 * - **`1m` is a calendar month, not thirty days.** A bill due on 31 March reminds on 28 February.
 *   Thirty days before 31 March is 1 March, which is a different month and, for anybody paid
 *   monthly, a different pay cheque.
 * - **A late period produces one overdue notice and no lead-time reminders.** Telling somebody a
 *   bill is due in three days when it was due last week is worse than saying nothing.
 * - **A period due today with a `0d` offset is `due_soon`, not `overdue`.** It is due, not late.
 */

import { describe, expect, it } from 'vitest'

import {
  OVERDUE_OFFSET,
  RECURRING_DUE_SOON_EVENT,
  RECURRING_OVERDUE_EVENT,
  dueReminders,
  isRecurringReminderDispatcherInstalled,
  reminderSendDay,
} from '../reminders'

import type { ReminderSubject } from '../reminders'
import type { RemindBeforeOffset } from '#/server/repos/recurring'

function subject(patch: Partial<ReminderSubject> = {}): ReminderSubject {
  return {
    seriesId: 'series-rent',
    seriesName: 'Rent',
    notifyEmail: false,
    remindBefore: ['3d'],
    periodStart: '2026-03-01',
    dueOn: '2026-03-10',
    expectedAmountMinor: 250_000,
    expectedCurrencyCode: 'PLN',
    ...patch,
  }
}

describe('the day an offset points at', () => {
  it.each<[RemindBeforeOffset, string]>([
    ['0d', '2026-03-31'],
    ['1d', '2026-03-30'],
    ['2d', '2026-03-29'],
    ['3d', '2026-03-28'],
    ['5d', '2026-03-26'],
    ['1w', '2026-03-24'],
    ['2w', '2026-03-17'],
    ['1m', '2026-02-28'],
  ])('%s before 31 March 2026 is %s', (offset, expected) => {
    expect(reminderSendDay('2026-03-31', offset)).toBe(expected)
  })

  it('subtracts a calendar month across a leap February', () => {
    expect(reminderSendDay('2024-03-31', '1m')).toBe('2024-02-29')
  })
})

describe('which reminders are due today', () => {
  it('sends nothing on a day no offset points at', () => {
    expect(dueReminders([subject()], '2026-03-05')).toEqual([])
  })

  it('sends the lead-time reminder on exactly its day', () => {
    const due = dueReminders([subject()], '2026-03-07')
    expect(due).toHaveLength(1)
    expect(due.at(0)?.offset).toBe('3d')
    expect(due.at(0)?.event).toBe(RECURRING_DUE_SOON_EVENT)
  })

  it('calls a period due today due, not late', () => {
    const due = dueReminders([subject({ remindBefore: ['0d'] })], '2026-03-10')
    expect(due.at(0)?.event).toBe(RECURRING_DUE_SOON_EVENT)
  })

  it('sends exactly one overdue notice and no lead times once a period is late', () => {
    const due = dueReminders(
      [subject({ remindBefore: ['0d', '1d', '3d'] })],
      '2026-03-11',
    )
    expect(due).toHaveLength(1)
    expect(due.at(0)?.offset).toBe(OVERDUE_OFFSET)
    expect(due.at(0)?.event).toBe(RECURRING_OVERDUE_EVENT)
  })

  it('sends one reminder per offset that lands on the same day', () => {
    // Two offsets can point at one day only for two different periods, so this is really a check
    // that the loop is per subject and does not collapse them.
    const due = dueReminders(
      [subject(), subject({ periodStart: '2026-04-01', dueOn: '2026-03-10' })],
      '2026-03-07',
    )
    expect(due).toHaveLength(2)
    expect(new Set(due.map((one) => one.periodStart)).size).toBe(2)
  })

  it('carries the amount and the currency untouched', () => {
    const due = dueReminders([subject()], '2026-03-07')
    expect(due.at(0)?.expectedAmountMinor).toBe(250_000)
    expect(due.at(0)?.expectedCurrencyCode).toBe('PLN')
  })
})

describe('the dispatcher seam', () => {
  it('reports that nothing is installed yet', () => {
    // Plan 21 installs the real one. Until then this is false, the cron logs it, and "nothing is
    // being sent" is visible in production rather than inferred from an empty function body.
    expect(isRecurringReminderDispatcherInstalled()).toBe(false)
  })
})
