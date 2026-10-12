/**
 * The refusals the data layer is allowed to raise.
 *
 * One family, one base class, one `code` per kind, so a route, a server function and a queue
 * handler all describe the same refusal in the same vocabulary and the failure classifier
 * (`classifyFailure` in `src/server/errors/classify.ts`) has a single thing to switch on. Not every
 * constructor takes structured fields: some interpolate a value into their sentence, which is why
 * the server-function boundary replaces the sentence (`redactError` and the envelope in
 * `src/server/errors/`).
 *
 * **The load-bearing decision in this file is that a cross-tenant read is a {@link NotFoundError}
 * and never a {@link ForbiddenError}.** A 403 confirms that the row exists — it turns a guessed id
 * into an oracle for "does workspace X have a transaction with this id", which is a disclosure in
 * its own right. Not seeing must be indistinguishable from not existing, in reads, in counts and
 * in aggregates alike. `ForbiddenError` is for the *other* refusal: the caller is inside the right
 * workspace and their role is not enough.
 *
 * Messages here are developer-facing. Customer-facing copy is chosen by the surface from `code`,
 * against the i18n catalogue — a message written here would be permanently English, and these are
 * raised below the layer that knows the reader's language.
 */

/** Base class for every refusal raised inside `src/server/repos`. */
export class RepositoryError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

/**
 * A repository was reached without a usable {@link import('./scope').TenantScope}.
 *
 * In practice unreachable through the exported API — a scope is a required first argument
 * everywhere — so this is what a hand-built or half-populated context hits at
 * `createScope`, before any SQL is composed.
 */
export class MissingTenantContextError extends RepositoryError {
  constructor(detail: string) {
    super(`Tenant context is required: ${detail}.`, 'MISSING_TENANT_CONTEXT')
  }
}

/**
 * A row that arrived from outside a scoped query turned out to belong to another workspace.
 *
 * The scoped helpers make this unreachable for anything they load. It exists for the rows that do
 * not come through them — a queue message, a webhook payload, a Durable Object callback — so those
 * paths can re-assert ownership and fail loudly instead of leaking quietly.
 */
export class TenantIsolationError extends RepositoryError {
  constructor(entity: string) {
    super(`Cross-tenant access to ${entity} was rejected.`, 'TENANT_ISOLATION')
  }
}

/**
 * A write composed to an empty predicate list — an `UPDATE` or `DELETE` with no `WHERE`.
 *
 * The tenant predicate is appended by the base repository and cannot be removed, so this is the
 * backstop for the one case the types cannot see: a dynamically assembled `and(...)` that collapses
 * to `undefined` because every branch was skipped.
 */
export class UnscopedWriteError extends RepositoryError {
  constructor(entity: string) {
    super(`Refusing to write to every row of ${entity}.`, 'UNSCOPED_WRITE')
  }
}

/** A row addressed by id does not exist **inside the caller's workspace**. */
export class NotFoundError extends RepositoryError {
  readonly entity: string
  readonly id: string

  constructor(entity: string, id: string) {
    super(`${entity} ${id} was not found.`, 'NOT_FOUND')
    this.entity = entity
    this.id = id
  }
}

/** The caller is in the right workspace and their role does not permit the action. */
export class ForbiddenError extends RepositoryError {
  readonly action: string

  constructor(action: string, required: ReadonlyArray<string>) {
    super(
      `Role not permitted to ${action}; requires one of: ${required.join(', ')}.`,
      'FORBIDDEN',
    )
    this.action = action
  }
}

/**
 * The write is legal in isolation and collides with the state it would land in — a unique index, a
 * duplicate link, an invariant that needs a second row to check (`Σ splits = parent`, the two-level
 * category cap, "a transaction with splits cannot become a transfer").
 *
 * Takes the sentence rather than an entity and a detail, because the interesting half of a conflict
 * is *which rule* was broken, and that rule is usually about two rows rather than about one table.
 */
export class ConflictError extends RepositoryError {
  constructor(message: string) {
    super(message, 'CONFLICT')
  }
}

/** A metered resource would go past the workspace's plan ceiling. */
export class QuotaExceededError extends RepositoryError {
  readonly metric: string
  readonly limit: number
  readonly current: number

  constructor(metric: string, limit: number, current: number) {
    super(
      `Quota for ${metric} reached (${current}/${limit}).`,
      'QUOTA_EXCEEDED',
    )
    this.metric = metric
    this.limit = limit
    this.current = current
  }
}

/** The workspace's plan does not include this module at all. */
export class FeatureLockedError extends RepositoryError {
  readonly module: string

  constructor(module: string) {
    super(
      `The ${module} module is not included in this plan.`,
      'FEATURE_LOCKED',
    )
    this.module = module
  }
}

/**
 * No exchange rate could be resolved for a pair on a date.
 *
 * A refusal rather than a fallback: converting at a rate nobody published produces a
 * `ref_amount_minor` that is wrong forever, because §3.5 never recomputes one.
 */
export class RateUnavailableError extends RepositoryError {
  readonly baseCode: string
  readonly quoteCode: string
  readonly date: string

  constructor(baseCode: string, quoteCode: string, date: string) {
    super(
      `No exchange rate for ${baseCode}/${quoteCode} on ${date}.`,
      'RATE_UNAVAILABLE',
    )
    this.baseCode = baseCode
    this.quoteCode = quoteCode
    this.date = date
  }
}

/**
 * The workspace would be left with nobody who can administer it.
 *
 * Separate from {@link ConflictError} because the surface needs its own sentence: "you are the last
 * owner" is advice about what to do next (hand ownership over first), not a collision to retry.
 */
export class LastOwnerError extends RepositoryError {
  constructor() {
    super('A workspace must keep at least one owner.', 'LAST_OWNER')
  }
}

/**
 * An invitation exists, and the account presenting it is not the one it was addressed to.
 *
 * Distinct from {@link NotFoundError} on purpose, and the distinction is safe: reaching this state
 * requires holding the invitation's single-use id, so it confirms nothing to somebody who was not
 * sent it. Telling the reader *which* address was invited is what lets them sign out and sign in
 * as the right person, which is the whole recovery path.
 */
export class InvitationAddresseeError extends RepositoryError {
  readonly invitedEmail: string

  constructor(invitedEmail: string) {
    super(
      `The invitation was issued to ${invitedEmail}.`,
      'INVITATION_ADDRESSEE',
    )
    this.invitedEmail = invitedEmail
  }
}

/** The invitation is real and can no longer be accepted: expired, revoked or already used. */
export class InvitationClosedError extends RepositoryError {
  readonly state: 'expired' | 'revoked' | 'accepted'

  constructor(state: 'expired' | 'revoked' | 'accepted') {
    super(`The invitation is ${state}.`, 'INVITATION_CLOSED')
    this.state = state
  }
}

export function isRepositoryError(error: unknown): error is RepositoryError {
  return error instanceof RepositoryError
}
