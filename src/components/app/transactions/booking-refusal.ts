import { ZodError } from 'zod'

import type { RefusedBooking } from './transaction-form'

/**
 * Telling the booking rule's refusal from every other failed save.
 *
 * The server refuses a settled row dated after the latest calendar day on Earth with a Zod `custom`
 * issue at `bookedOn` (`#/server/booking-rule`). After a server-function round trip it is a plain
 * `Error` whose message is the JSON issue list, so it is recognised by that structure and nothing
 * else. This is client code and imports nothing from `server/`; the shape it reads is the one
 * `validationIssuesOf` (`#/server/errors/classify`) reads, narrowed to the one issue this form can
 * say better than the server's English.
 */

/** A longer list is cut here, never trusted: only the first items are looked at. */
const MAX_ISSUES_READ = 100

/** Whether `error` is the server's refusal of a settled row dated after the cutoff. Never throws. */
export function isBookedOnRefusal(error: unknown): boolean {
  try {
    return issuesOf(error).some(isBookedOnCustomIssue)
  } catch {
    return false
  }
}

function issuesOf(error: unknown): ReadonlyArray<unknown> {
  if (error instanceof ZodError) return error.issues.slice(0, MAX_ISSUES_READ)
  if (!(error instanceof Error)) return []
  // A subclass (a `TypeError`, a repository error) names its own cause; only the bare `Error` the
  // serialiser rebuilds carries an issue list.
  if (Object.getPrototypeOf(error) !== Error.prototype) return []
  const parsed: unknown = JSON.parse(error.message)
  return Array.isArray(parsed) ? parsed.slice(0, MAX_ISSUES_READ) : []
}

function isBookedOnCustomIssue(item: unknown): boolean {
  if (typeof item !== 'object' || item === null) return false
  const { path, code } = item as { path?: unknown; code?: unknown }
  return (
    code === 'custom' &&
    Array.isArray(path) &&
    path.length === 1 &&
    path[0] === 'bookedOn'
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
 * banner: the error's own message, or `fallback` for a value that is not an `Error`.
 */
export function saveFailureOf(
  error: unknown,
  entry: RefusedBooking,
  fallback: string,
): SaveFailure {
  if (isBookedOnRefusal(error)) {
    return {
      refusedBooking: { bookedOn: entry.bookedOn, isPlanned: entry.isPlanned },
    }
  }
  return { serverError: error instanceof Error ? error.message : fallback }
}
