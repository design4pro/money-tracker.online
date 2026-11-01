import { readFailure } from '#/lib/failure'

import type { FailureKind } from '#/lib/failure-envelope'
import type { MessageKey } from '#/lib/i18n'

const REFUSAL_BY_KIND: Partial<Readonly<Record<FailureKind, MessageKey>>> = {
  not_found: 'accounts.group.refused.notFound',
  forbidden: 'accounts.group.refused.forbidden',
  conflict: 'accounts.group.refused.conflict',
}

/**
 * The sentence the groups screen shows when a write is refused.
 *
 * It is chosen from the failure's **kind** (the public envelope's) and from nothing the error says:
 * a repository message is English, carries an id, and for a database failure may carry SQL. A
 * branch on the `message` would be the leak the failure readers test refuses.
 *
 * `GroupDepthError` is a `ConflictError`, and the envelope keeps the kind and drops the class, so
 * "too deep" and any other conflict arrive as the same `conflict`. The menu disables every item
 * that would nest a third level and the drag never offers such a drop, so the depth rule is reached
 * only by a stale list. One sentence covers it and names the rule. A kind this screen has no
 * sentence for - a database or foreign-key failure from a race, a validation failure, a plain
 * `Error` - reads as the generic line.
 *
 * The envelope is what a failing server function delivers: the failure middleware builds it and the
 * serialization adapter in `#/lib/public-failure` carries it to the browser as a `PublicFailureError`.
 * An error that did not come through it (a dropped connection, a framework error) has no kind and
 * reads as the generic line.
 */
export function refusalFor(error: unknown): MessageKey {
  const failure = readFailure(error)
  return (
    (failure === null ? undefined : REFUSAL_BY_KIND[failure.kind]) ??
    'accounts.group.refused.generic'
  )
}
