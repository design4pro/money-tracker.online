/**
 * The task queue's batch dispatcher.
 *
 * `worker.ts` is a shared path with one writer at a time, so the consumer loop lives here and takes
 * its handler table as an argument. A plan that adds a job kind writes one handler file and
 * replaces one entry in `handlers/index.ts`; it never edits the loop. The same argument is what lets
 * the `workerd` project drive the dispatcher against real bindings without importing the
 * application.
 *
 * Every kind but `billing.event` runs under the KV claim of `./claim`, a concurrency guard whose
 * held case is a delayed retry. The billing event takes none: its row status is its idempotency.
 *
 * Dependency direction: this module imports the envelope, the claim, the database factory and the
 * logger, and nothing from `handlers/`, `repos/` or `cloudflare:workers`. The registry and the Worker entry
 * import it, never the reverse.
 *
 * Messages are acknowledged or retried **one at a time**, never with `ackAll` or `retryAll`: a
 * batch of ten in which one message throws would otherwise redeliver the nine that already
 * succeeded, and a redelivered billing event is a second chance to apply one state change.
 */

import { dbFromEnv } from '../db/from-env'
import { loggerFromEnv } from '../observability/logger'
import { CLAIM_RETRY_DELAY_SECONDS, claimKey, withTaskClaim } from './claim'
import { parseTaskMessage } from './messages'

import type { LogSink, Logger } from '../observability/logger'
import type { TaskMessage } from './messages'

export type TaskKind = TaskMessage['kind']

/** What a handler is given for one message. Built by the dispatcher, once per message. */
export interface TaskContext {
  readonly db: ReturnType<typeof dbFromEnv>
  /** Carries `component: 'queue'` and the queue name as `route`. */
  readonly logger: Logger
  /** Injected so a handler test pins the clock. */
  readonly now: () => Date
}

/**
 * A handler's way of saying "this message must never succeed" (a workspace or batch that does not
 * match the envelope). The dispatcher acknowledges it and logs at `error` with ids only; the string
 * is the handler's own label for the refusal and is deliberately not logged, because a free-form
 * reason is how a row value ends up in a log line.
 */
export interface PermanentRefusal {
  readonly permanent: string
}

/**
 * Resolving acknowledges, returning {@link PermanentRefusal} acknowledges and logs an error, and
 * throwing is infrastructure that another attempt might resolve, so the message is retried.
 */
export type TaskHandler<K extends TaskKind> = (
  task: Extract<TaskMessage, { kind: K }>,
  ctx: TaskContext,
) => Promise<void | PermanentRefusal>

/** One handler per kind; a kind added to the envelope union fails to compile until it has one. */
export type TaskHandlers = { [K in TaskKind]: TaskHandler<K> }

export interface TaskBatchOptions {
  readonly now?: () => Date
  /** Where the dispatcher's own logger writes; the console when omitted. */
  readonly sink?: LogSink
}

/**
 * Runs the handler registered for `task.kind`.
 *
 * This is the one place a cast is allowed. `handlers[task.kind]` has the type
 * `TaskHandlers[TaskKind]`, a union of functions whose parameters TypeScript intersects, so it
 * cannot see that the handler it picked accepts exactly this `task`. The invariant that makes the
 * cast true: `TaskHandlers` maps each kind `K` to a handler of `Extract<TaskMessage, { kind: K }>`,
 * and `task.kind` is the key used to look it up, so the pair always agrees.
 *
 * A missing entry rejects instead of throwing synchronously, so both failures reach the caller's
 * `catch` through the same `await`.
 */
function runHandler<K extends TaskKind>(
  handlers: TaskHandlers,
  task: Extract<TaskMessage, { kind: K }>,
  ctx: TaskContext,
): Promise<void | PermanentRefusal> {
  const handler = handlers[task.kind] as TaskHandler<K> | undefined
  // The type says an entry exists for every kind; a registry built before a kind was added, or by a
  // cast, is the one way it might not. Throwing keeps it a retry, never an acknowledgement.
  if (!handler) {
    return Promise.reject(
      new Error(`no handler is registered for ${task.kind}`),
    )
  }
  return handler(task, ctx)
}

function isPermanentRefusal(
  outcome: void | PermanentRefusal,
): outcome is PermanentRefusal {
  return typeof outcome === 'object' && 'permanent' in outcome
}

export async function handleTaskBatch(
  batch: MessageBatch<unknown>,
  env: Env,
  handlers: TaskHandlers,
  options: TaskBatchOptions = {},
): Promise<void> {
  const logger = loggerFromEnv(env, {
    context: { component: 'queue', route: batch.queue },
    sink: options.sink,
  })
  const now = options.now ?? (() => new Date())

  for (const message of batch.messages) {
    const task = parseTaskMessage(message.body)
    if (!task) {
      // A body no handler in this deploy recognises is acknowledged with a warning rather than
      // retried: five attempts at a message nothing can process reach the dead-letter queue with
      // no more information than the first attempt had.
      logger.warn('queue message has no handler', {
        queue: batch.queue,
        messageId: message.id,
      })
      message.ack()
      continue
    }

    try {
      const ctx = { db: dbFromEnv(env), logger, now }
      const run = () => runHandler(handlers, task, ctx)
      const claimed =
        task.kind === 'billing.event'
          ? { held: true as const, result: await run() }
          : await withTaskClaim(env.KV, claimKey(task), run, logger)
      if (!claimed.held) {
        // Another delivery is running this job. Acknowledging would lose it if that worker
        // crashed, so it comes back after a delay; the claim's expiry is what ends a crashed hold.
        logger.info('queue message claim is held', {
          kind: task.kind,
          messageId: message.id,
        })
        message.retry({ delaySeconds: CLAIM_RETRY_DELAY_SECONDS })
        continue
      }
      const outcome = claimed.result
      if (isPermanentRefusal(outcome)) {
        logger.error('queue message refused permanently', undefined, {
          kind: task.kind,
          messageId: message.id,
        })
      }
      message.ack()
    } catch (error) {
      // Reaching here means the handler could not complete for a reason another attempt might
      // resolve, a database that did not answer. Every *logical* failure is the handler's to
      // record and acknowledge (or to refuse permanently), so a retry here is never a second
      // attempt at the same rejected payload. A kind with no installed handler lands here too, on
      // purpose: it is retried until the retry limit moves it to the dead-letter queue, and never
      // acknowledged.
      logger.error('queue message failed', error, {
        kind: task.kind,
        attempt: message.attempts,
        messageId: message.id,
      })
      message.retry()
    }
  }
}
