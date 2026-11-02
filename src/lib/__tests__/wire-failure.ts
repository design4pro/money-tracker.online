import { FAILURE_MESSAGE_KEYS } from '#/lib/failure-envelope'

import type { FailureKind } from '#/lib/failure-envelope'

/** A repository sentence of the kind that must never reach a screen: an id and a count. */
export const LEAKED_MESSAGE = 'Account 01k9z still has 412 transaction(s)'

/**
 * A failing server function as the browser sees it: an `Error` whose own `envelope` survived the
 * wire, and whose `message` is whatever the test wants to prove stays off the screen.
 */
export function wireFailure(
  kind: FailureKind,
  message: string = LEAKED_MESSAGE,
): Error {
  return Object.assign(new Error(message), {
    envelope: { v: 1, kind, message: { key: FAILURE_MESSAGE_KEYS[kind] } },
  })
}
