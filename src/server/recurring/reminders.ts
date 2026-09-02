/**
 * When a series should say something, and what it should say.
 *
 * ---------------------------------------------------------------------------
 * THIS STAGE DECIDES; PLAN 21 DELIVERS
 * ---------------------------------------------------------------------------
 *
 * Nothing here sends anything. Email, push, the in-app inbox and the person's own quiet hours are
 * `21-S1`'s, in one place. What belongs *here* is the arithmetic that decides a reminder is due,
 * because only this module knows what `remind_before` means on a calendar.
 *
 * {@link setRecurringReminderDispatcher} is the seam, and it is the same named no-op arrangement
 * `12-S3` uses for budget alerts: until `21-S1` installs a real dispatcher every due reminder goes
 * to a function called {@link NOOP_REMINDER_DISPATCHER}, so "nothing is being sent yet" is
 * greppable rather than inferred from an empty body. {@link isRecurringReminderDispatcherInstalled}
 * is what the cron logs, so the gap is visible in production rather than silent.
 *
 * **`1m` is a calendar month, not thirty days.** A bill due on 31 March reminds on 28 February, and
 * the subtraction goes through `@internationalized/date` like every other date step in this
 * feature. Thirty days before 31 March is 1 March, which is a different month and, for anybody
 * paid monthly, a different pay cheque.
 */

import { parseDate } from '@internationalized/date'

import type { RemindBeforeOffset } from '#/server/repos/recurring'
import type { TenantScope } from '#/server/repos/base'

/** The two events `21-S1` delivers. Named here because this module decides which one applies. */
export const RECURRING_DUE_SOON_EVENT = 'recurring.due_soon'
export const RECURRING_OVERDUE_EVENT = 'recurring.overdue'

export type RecurringReminderEvent =
  typeof RECURRING_DUE_SOON_EVENT | typeof RECURRING_OVERDUE_EVENT

/**
 * The marker suffix an overdue notice is deduped by.
 *
 * Not one of the `remind_before` offsets: overdue is not a lead time, it is a state, and it is
 * announced **once** per period rather than once per configured offset. Sharing the key space with
 * the offsets keeps one marker shape for the whole feature.
 */
export const OVERDUE_OFFSET = 'overdue'

/** One reminder that is due today, for one period of one series. */
export interface DueReminder {
  readonly seriesId: string
  readonly seriesName: string
  readonly periodStart: string
  readonly dueOn: string
  /** The configured offset, or {@link OVERDUE_OFFSET}. Part of the dedupe key. */
  readonly offset: string
  readonly event: RecurringReminderEvent
  readonly expectedAmountMinor: number
  readonly expectedCurrencyCode: string
  /** Whether the workspace asked for this one by email as well as in the inbox. */
  readonly notifyEmail: boolean
}

/** What a series and one of its unpaid periods contribute to the decision. */
export interface ReminderSubject {
  readonly seriesId: string
  readonly seriesName: string
  readonly notifyEmail: boolean
  readonly remindBefore: ReadonlyArray<RemindBeforeOffset>
  readonly periodStart: string
  readonly dueOn: string
  readonly expectedAmountMinor: number
  readonly expectedCurrencyCode: string
}

/**
 * The day an offset points at, counted back from the due date.
 *
 * `1m` subtracts a **month**; everything else subtracts a fixed number of days, which is exactly
 * what `1w` and `2w` mean — a week is seven days on every calendar this product ships.
 */
export function reminderSendDay(
  dueOn: string,
  offset: RemindBeforeOffset,
): string {
  const due = parseDate(dueOn)
  if (offset === '1m') return due.subtract({ months: 1 }).toString()
  const days: Record<Exclude<RemindBeforeOffset, '1m'>, number> = {
    '0d': 0,
    '1d': 1,
    '2d': 2,
    '3d': 3,
    '5d': 5,
    '1w': 7,
    '2w': 14,
  }
  return due.subtract({ days: days[offset] }).toString()
}

/**
 * Which reminders are due **today**, for a set of unpaid periods.
 *
 * Pure: no scope, no database, no clock. `today` is a parameter, which is what makes every case in
 * `__tests__` a fixed pair of dates rather than a mock of `Date.now`.
 *
 * A period that is already late produces one `recurring.overdue` and **no** lead-time reminders:
 * telling somebody a bill is due in three days when it was due last week is worse than saying
 * nothing. A period due today with a `0d` offset produces `recurring.due_soon`, which is the
 * correct event — it is due, not late.
 */
export function dueReminders(
  subjects: ReadonlyArray<ReminderSubject>,
  today: string,
): ReadonlyArray<DueReminder> {
  const due: Array<DueReminder> = []

  for (const subject of subjects) {
    const base = {
      seriesId: subject.seriesId,
      seriesName: subject.seriesName,
      periodStart: subject.periodStart,
      dueOn: subject.dueOn,
      expectedAmountMinor: subject.expectedAmountMinor,
      expectedCurrencyCode: subject.expectedCurrencyCode,
      notifyEmail: subject.notifyEmail,
    }

    if (subject.dueOn < today) {
      due.push({
        ...base,
        offset: OVERDUE_OFFSET,
        event: RECURRING_OVERDUE_EVENT,
      })
      continue
    }

    for (const offset of subject.remindBefore) {
      if (reminderSendDay(subject.dueOn, offset) !== today) continue
      due.push({ ...base, offset, event: RECURRING_DUE_SOON_EVENT })
    }
  }

  return due
}

/** What `21-S1` installs. Takes the due reminders of **one** workspace, already deduped. */
export type RecurringReminderDispatcher = (
  scope: TenantScope,
  reminders: ReadonlyArray<DueReminder>,
) => Promise<void>

/**
 * The placeholder dispatcher: it does nothing, on purpose, and it is named so that "nothing is
 * being sent yet" is greppable rather than inferred from an empty function body somewhere.
 */
export const NOOP_REMINDER_DISPATCHER: RecurringReminderDispatcher =
  async () => {}

let dispatcher: RecurringReminderDispatcher = NOOP_REMINDER_DISPATCHER

/** Installs the real dispatcher (`21-S1`). `null` restores the no-op. */
export function setRecurringReminderDispatcher(
  next: RecurringReminderDispatcher | null,
): void {
  dispatcher = next ?? NOOP_REMINDER_DISPATCHER
}

/** True while nothing is being delivered. The cron logs it, so the gap is visible in production. */
export function isRecurringReminderDispatcherInstalled(): boolean {
  return dispatcher !== NOOP_REMINDER_DISPATCHER
}

/** Hands one workspace's due reminders to whatever is installed. */
export async function dispatchReminders(
  scope: TenantScope,
  reminders: ReadonlyArray<DueReminder>,
): Promise<void> {
  if (reminders.length === 0) return
  await dispatcher(scope, reminders)
}
