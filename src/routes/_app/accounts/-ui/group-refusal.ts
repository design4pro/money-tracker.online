import { readFailure } from '#/lib/failure'

import type { FailureKind } from '#/lib/failure-envelope'
import type { MessageKey } from '#/lib/i18n'

/**
 * The repository `code`s this screen can tell apart, as the kinds the classifier gives them.
 *
 * The public envelope is all that will cross the server-function boundary once the redaction
 * middleware of plan stage `05-S1` is registered. Until then the framework still rebuilds the
 * thrown error on the client with its `name`, `message` and own properties, and a repository
 * error's own `code` is the one classified field among them. A branch on the `message` would be
 * the leak the failure readers test refuses; a branch on a closed `code` is not.
 */
const KIND_BY_CODE: ReadonlyMap<string, FailureKind> = new Map([
  ['NOT_FOUND', 'not_found'],
  ['FORBIDDEN', 'forbidden'],
  ['CONFLICT', 'conflict'],
])

const REFUSAL_BY_KIND: Partial<Readonly<Record<FailureKind, MessageKey>>> = {
  not_found: 'accounts.group.refused.notFound',
  forbidden: 'accounts.group.refused.forbidden',
  conflict: 'accounts.group.refused.conflict',
}

export interface GroupRefusal {
  readonly messageKey: MessageKey
  /**
   * The list the person was looking at is no longer true (a group deleted in another window), so
   * the loader reruns and the sentence says so.
   */
  readonly isStale: boolean
}

function kindOf(error: unknown): FailureKind | undefined {
  const failure = readFailure(error)
  if (failure !== null) return failure.kind
  if (typeof error !== 'object' || error === null) return undefined
  const { code } = error as { readonly code?: unknown }
  return typeof code === 'string' ? KIND_BY_CODE.get(code) : undefined
}

/**
 * The sentence the groups screen shows when a write is refused.
 *
 * It is chosen from the failure's **kind** and from nothing the error says: a repository message
 * is English, carries an id, and for a database failure may carry SQL. The kind is the public
 * envelope's when there is one, otherwise the repository `code` (see {@link KIND_BY_CODE}).
 *
 * `GroupDepthError` is a `ConflictError`, and both routes keep the kind and drop the class, so
 * "too deep" and any other conflict arrive as the same `conflict`. The menu disables every item
 * that would nest a third level, but a drop cannot know which row is being dragged, so dropping a
 * group that has children beside a child reaches the repository too (as does a two-tab race). One
 * sentence covers both and names the rule. A kind this screen has no sentence for - a
 * database or foreign-key failure from a race, a validation failure, a plain `Error` - reads as
 * the generic line.
 */
export function refusalFor(error: unknown): GroupRefusal {
  const kind = kindOf(error)
  return {
    messageKey:
      (kind === undefined ? undefined : REFUSAL_BY_KIND[kind]) ??
      'accounts.group.refused.generic',
    isStale: kind === 'not_found',
  }
}
