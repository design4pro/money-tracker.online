/**
 * The booking rule: a settled row may not be dated after the latest calendar day on Earth.
 *
 * A non-planned row counts in balances at once, and its `ref_amount_minor` is resolved through the
 * 7-day look-back (`docs/MONEY.md` §2.3, rung 3) and never recomputed (§3), so a future date freezes
 * a borrowed rate for good. A planned row is a forecast, not a posting, and keeps any date
 * (`docs/MONEY.md` §5.2). Every writer that can produce a settled row asks this module, so the rule
 * has one owner and deleting this file removes it.
 *
 * **It is a rule about a pair, `(bookedOn, isPlanned)`, not about a date.** A refinement on the
 * date alone cannot see the sibling flag, and an update does not know the flag until it has been
 * merged with the stored row. So the repositories call {@link assertBookable} with the merged pair,
 * after their own shape validation, and the cutoff day is the one {@link latestCalendarDayOnEarth}
 * computes - read server-side only, never from a request, a policies object or a development pin.
 *
 * **An update is judged on what it changes.** The detail screen re-sends `bookedOn` and `isPlanned`
 * on every save, so "the patch names them" would refuse a note-only edit of a legacy row dated in
 * the future. Passing the stored pair as `stored` exempts a merged pair that equals it: nothing the
 * person did made the row more settled or later. Flipping a future-dated planned row to posted, or
 * moving a non-planned row to another future date, changes the pair and is refused.
 *
 * A refusal is a Zod `custom` issue at `bookedOn`, so the failure envelope renders it as
 * `failure.field.invalid` exactly as the balance-adjustment schemas do, and it is raised before
 * any conversion lookup, insert or update, so nothing is written.
 */

import { z } from 'zod'

import { latestCalendarDayOnEarth } from '#/server/clock'

/** The two fields the rule reads. A row, a patch merged onto a row, or a leg about to be written. */
export interface BookingPair {
  readonly bookedOn: string
  readonly isPlanned: boolean
}

/** Whether a row with this pair may be stored at `now`. ISO dates compare correctly as strings. */
export function isBookable(pair: BookingPair, now: Date = new Date()): boolean {
  return pair.isPlanned || pair.bookedOn <= latestCalendarDayOnEarth(now)
}

/**
 * Throws a validation error at `bookedOn` when `next` is a settled row dated after the cutoff.
 *
 * `stored` is the pair already on the row, for an update: a `next` equal to it passes untouched.
 */
export function assertBookable(
  next: BookingPair,
  options: { readonly stored?: BookingPair; readonly now?: Date } = {},
): void {
  const { stored, now } = options
  if (
    stored !== undefined &&
    stored.bookedOn === next.bookedOn &&
    stored.isPlanned === next.isPlanned
  ) {
    return
  }
  if (isBookable(next, now)) return
  throw new z.ZodError([
    {
      code: 'custom',
      path: ['bookedOn'],
      message:
        'A settled row cannot be dated after the latest calendar day on Earth.',
      input: next.bookedOn,
    },
  ])
}
