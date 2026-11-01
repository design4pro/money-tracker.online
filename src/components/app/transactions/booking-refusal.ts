import { failureOf, readFailure } from '#/lib/failure'

import type { Translate } from '#/lib/i18n'

import type { RefusedBooking } from './transaction-form'

/**
 * Telling the booking rule's refusal from every other failed save.
 *
 * The server refuses a settled row dated after the latest calendar day on Earth with a Zod `custom`
 * issue at `bookedOn` (`#/server/booking-rule`). The failure middleware turns that into a
 * `validation` envelope whose `fields` name the path and never the issue's own sentence, so it is
 * recognised by that kind and path and nothing else. The envelope's field key is `invalid` for every
 * issue code but the two length codes, so a malformed date at the same path reads as a refusal too;
 * the date input does not let a malformed date through, and the sentence it gets is the one that
 * names the date.
 */

/** Whether `error` is the server's refusal of a settled row dated after the cutoff. Never throws. */
export function isBookedOnRefusal(error: unknown): boolean {
  const failure = readFailure(error)
  return (
    failure?.kind === 'validation' &&
    (failure.fields ?? []).some((field) => field.path === 'bookedOn')
  )
}

/** What a failed save leaves on the form: a banner message, or the booking date it refused. */
export interface SaveFailure {
  readonly serverError?: string
  readonly refusedBooking?: RefusedBooking
}

/** No failure: a fresh form, or one whose save went through. */
export const NO_SAVE_FAILURE: SaveFailure = {}

/**
 * The failure with its booking-date refusal dropped, for the moment a save starts.
 *
 * The date field says the refusal through a polite live region, which announces only when its text
 * changes. Clearing it as the next save starts makes a second refusal of the very same date change
 * the text again, instead of staying silent.
 */
export function withoutRefusal(failure: SaveFailure): SaveFailure {
  return failure.serverError === undefined
    ? NO_SAVE_FAILURE
    : { serverError: failure.serverError }
}

/**
 * What to show for a failed save of `entry`.
 *
 * A booking-date refusal is remembered as the `(date, planned)` pair that was refused, so the form
 * can say it at the date field and drop it the moment either changes. Any other failure keeps the
 * banner, with the catalogue sentence of its kind and never the error's own text.
 */
export function saveFailureOf(
  error: unknown,
  entry: RefusedBooking,
  t: Translate,
): SaveFailure {
  if (isBookedOnRefusal(error)) {
    return {
      refusedBooking: { bookedOn: entry.bookedOn, isPlanned: entry.isPlanned },
    }
  }
  return { serverError: t(failureOf(error).message.key) }
}
