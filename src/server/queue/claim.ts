/**
 * The KV claim a delivery of one of the five import, export and backup kinds takes before its
 * handler runs.
 *
 * **A concurrency guard, not the correctness mechanism.** Workers KV has no compare-and-swap, so
 * two deliveries can both read "free" and both write; the guard narrows the window in which two
 * workers run the same job, it does not close it. What makes a doubled run safe is each handler's
 * own database state (the batch's resume cursor, the export job's status), never this key.
 *
 * **The expiry is the crash safety net.** The claim is released when the handler returns or throws,
 * and a worker that dies in between never runs that release, so the key expires after
 * {@link CLAIM_TTL_SECONDS} and the retried message runs. This is also why a held claim is a
 * delayed retry and never an acknowledgement: acknowledging a duplicate would lose the job when the
 * first worker crashed.
 *
 * The value is a random per-delivery token and a release deletes the key only while it still holds
 * that token, so a slow worker that outlived the expiry cannot delete a claim a second worker has
 * since taken. A release that fails is logged at `warn` and never fails the message.
 *
 * `billing.event` takes no claim: its `billing_events` row status is its idempotency.
 */

import type { Logger } from '../observability/logger'
import type { TaskMessage } from './messages'

/** How long a claim lives if nobody releases it. KV's minimum `expirationTtl` is 60 seconds. */
export const CLAIM_TTL_SECONDS = 120

/**
 * How long a held claim waits before the message is delivered again. Each such retry consumes an
 * attempt, so `max_retries * CLAIM_RETRY_DELAY_SECONDS` must exceed {@link CLAIM_TTL_SECONDS} or a
 * claim could outlive the retry budget and lose the job (asserted in `wrangler-config.test.ts`).
 */
export const CLAIM_RETRY_DELAY_SECONDS = 45

/** The three KV calls the claim makes, so Node tests need no binding. A `KVNamespace` satisfies it. */
export interface ClaimStore {
  readonly get: (key: string) => Promise<string | null>
  readonly put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<void>
  readonly delete: (key: string) => Promise<void>
}

/** Every kind that takes a claim: all of them but the billing event. */
export type ClaimedTask = Exclude<TaskMessage, { kind: 'billing.event' }>

/** Stands in for the workspace of a platform-level kind, which has none. */
const PLATFORM = 'platform'

/**
 * `task:claim:v1:<kind>:<organizationId>:<identity>`, where the identity is the batch, the job or
 * the backup day. The workspace is in the key so one tenant's id can never hold or starve another's.
 */
export function claimKey(task: ClaimedTask): string {
  switch (task.kind) {
    case 'import.parse':
    case 'import.execute':
    case 'import.revert':
      return `task:claim:v1:${task.kind}:${task.organizationId}:${task.batchId}`
    case 'export.build':
      return `task:claim:v1:${task.kind}:${task.organizationId}:${task.jobId}`
    case 'backup.run':
      return `task:claim:v1:${task.kind}:${PLATFORM}:${task.date}`
  }
}

export type ClaimOutcome<T> =
  { readonly held: true; readonly result: T } | { readonly held: false }

/**
 * Runs `run` while holding the claim `key`.
 *
 * Resolves `{ held: false }` without running when another delivery holds it (the caller retries
 * with {@link CLAIM_RETRY_DELAY_SECONDS}), and `{ held: true, result }` when this delivery held the
 * claim and `run` returned. A failing claim read or write throws before `run`, so the handler never
 * runs unguarded; `run`'s own error is rethrown after the release.
 */
export async function withTaskClaim<T>(
  store: ClaimStore,
  key: string,
  run: () => Promise<T>,
  logger: Logger,
): Promise<ClaimOutcome<T>> {
  if ((await store.get(key)) !== null) return { held: false }

  const token = crypto.randomUUID()
  await store.put(key, token, { expirationTtl: CLAIM_TTL_SECONDS })
  try {
    return { held: true, result: await run() }
  } finally {
    await release(store, key, token, logger)
  }
}

/** Deletes the claim only while it is still this delivery's; never throws. */
async function release(
  store: ClaimStore,
  key: string,
  token: string,
  logger: Logger,
): Promise<void> {
  try {
    if ((await store.get(key)) === token) await store.delete(key)
  } catch (error) {
    // The expiry clears the key; failing the message here would redo finished work.
    logger.warn('task claim release failed', {
      key,
      error: error instanceof Error ? error.name : 'unknown',
    })
  }
}
