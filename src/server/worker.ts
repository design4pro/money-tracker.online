/**
 * The Worker entry point — `main` in `wrangler.jsonc`.
 *
 * TanStack Start's own entry (`@tanstack/react-start/server-entry`) exports only `fetch`. A
 * Worker, though, is the union of everything the configuration declares: this one also declares
 * a Durable Object class, a queue consumer and four cron triggers, and the runtime can only find
 * those if the **entry module** exports them. Miniflare is blunt about the omission — a
 * missing `AccountLedger` export fails isolate startup outright, so `vite dev` never serves a
 * request, and `wrangler deploy` refuses a migration naming a class it cannot resolve.
 *
 * Hence this module rather than the default entry: it re-creates Start's fetch handler and
 * exports it alongside the class, the consumer and the scheduler.
 */

import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'

// Side effect only: installs this isolate's `LEDGER` batch ports. The fetch path reaches them
// through the server functions it loads; a scheduled invocation loads no server function, so
// without this line every rebuild the cron enqueues would be silently dropped and the balances it
// moved would stay stale until the nightly sweep.
import './ledger'

// Side effect only: installs the plan-limit resolver into the repository layer. Without it the
// seam in `./repos/base` keeps its permissive default and every quota in the product is
// unenforced — silently, which is the failure mode this import exists to prevent.
import './billing/install'

// Side effect only: installs the three notification dispatchers. Without it the seams in
// `./budgets/thresholds`, `./recurring/reminders` and `./goals/reached` keep their `NOOP_*`
// defaults, every crossing and reminder the crons find is computed and then dropped, and the run
// summaries say `dispatcherInstalled: false`.
import './notify/install'

import { runBudgetPeriodSweep } from './cron/budget-periods'
import { runBudgetThresholdSweep } from './cron/budget-thresholds'
import {
  cronToday,
  runRecurringHourly,
  runRecurringReminderSweep,
} from './cron/recurring'
import { dbFromEnv } from './db/from-env'
import { handleBillingEvent } from './queue/handlers/billing-event'
import { parseTaskMessage } from './queue/messages'
import { createKvMarkerStore } from './recurring/markers'
import { listCronScopes } from './repos/recurring'
import { loggerFromEnv } from './observability/logger'

import type { Logger } from './observability/logger'
import type { RecurringCronArgs } from './cron/recurring'

/**
 * Exported so `durable_objects.bindings[].class_name` resolves on every environment. The class
 * and its rebuild port live in `./do/account-ledger`, because the `workerd` vitest project needs
 * the same wired class from an entry that does not pull the application in behind it.
 */
export { AccountLedger } from './do/account-ledger'

const fetchHandler = createStartHandler(defaultStreamHandler)

/**
 * The four expressions `wrangler.jsonc` registers on production. Staging registers only
 * {@link NIGHTLY_CRON}; the other three branches are unreachable there, which is deliberate —
 * the reminder sweep would send real email from a database full of fixtures.
 */
const REMINDER_CRON = '*/15 * * * *'
const RECURRING_CRON = '7 * * * *'
const NIGHTLY_CRON = '0 3 * * *'
const WEEKLY_CRON = '17 4 * * 1'

/**
 * What each slot is *for*, so the warning a slot emits names the work that is missing rather
 * than just the expression that fired. The jobs themselves belong to later plans; until they
 * exist, a fired cron must be visible in Workers Observability rather than silently successful,
 * because "the nightly FX refresh has never run" and "the nightly FX refresh runs and does
 * nothing" look identical from the outside otherwise.
 */
const CRON_WORK: Readonly<Record<string, string | undefined>> = {
  // Both halves of this slot are wired below; tag reminders are still owed.
  [REMINDER_CRON]: 'tag reminders',
  // Both halves of this slot are wired below; nothing is owed on it.
  [RECURRING_CRON]: 'recurring auto-record and budget period materialisation',
  [NIGHTLY_CRON]:
    'FX rate refresh, balance-history revaluation sweep, D1 logical backup, expired export prune',
  [WEEKLY_CRON]:
    'platform audit-log prune, provider usage roll-up, orphaned R2 object sweep',
}

export default {
  /**
   * `fetchHandler` is Start's, and its second parameter is its own `RequestOptions` — not the
   * Worker `env` the runtime passes there. Naming only `request` keeps the two apart; handing
   * the environment to a parameter that expects request options was never intended.
   */
  fetch(request: Request): Response | Promise<Response> {
    return fetchHandler(request)
  },

  /**
   * The task queue consumer.
   *
   * Messages are acknowledged or retried **one at a time**, never with `ackAll`: a batch of ten in
   * which one message throws would otherwise redeliver the nine that already succeeded, and a
   * redelivered billing event is a second chance to apply one state change.
   *
   * A body no handler in this deploy recognises is acknowledged with a warn rather than retried —
   * five attempts at a message nothing can process reach the dead-letter queue with no more
   * information than the first attempt had. A handler that *throws* is a different thing: that is
   * infrastructure, and it is retried.
   */
  async queue(
    batch: MessageBatch<unknown>,
    env: Cloudflare.Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const logger: Logger = loggerFromEnv(env, {
      context: { component: 'queue', route: batch.queue },
    })

    for (const message of batch.messages) {
      const task = parseTaskMessage(message.body)
      if (!task) {
        logger.warn('queue message has no handler', {
          queue: batch.queue,
          messageId: message.id,
        })
        message.ack()
        continue
      }

      try {
        const outcome = await handleBillingEvent({
          db: dbFromEnv(env),
          eventId: task.eventId,
          now: new Date(),
          logger,
        })
        logger.debug('queue message handled', { kind: task.kind, outcome })
        message.ack()
      } catch (error) {
        // Reaching here means the handler could not complete for a reason another attempt might
        // resolve — a database that did not answer. Every *logical* failure is recorded on the
        // billing event row and acknowledged inside the handler, so a retry here is never a
        // second attempt at the same rejected payload.
        logger.error('queue message failed', error, {
          kind: task.kind,
          messageId: message.id,
        })
        message.retry()
      }
    }
  },

  /**
   * The cron handler.
   *
   * Switching on `controller.cron` against the four literals above is the whole dispatch: an
   * expression that is not one of them is a configuration drift between this file and
   * `wrangler.jsonc`, and it is reported as such rather than falling through to a default job.
   */
  async scheduled(
    controller: ScheduledController,
    env: Cloudflare.Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const logger: Logger = loggerFromEnv(env, {
      context: { component: 'scheduled', route: `cron:${controller.cron}` },
    })

    const pending = CRON_WORK[controller.cron]
    if (pending === undefined) {
      logger.warn('unrecognised cron expression', { cron: controller.cron })
      return
    }

    // The two quarter-hourly jobs and the hourly one are wired. The remaining slots are still
    // owed and still warn, so "the nightly FX refresh has never run" stays visible in Workers
    // Observability rather than being hidden by a slot that succeeds for a different reason.
    if (controller.cron === RECURRING_CRON) {
      // One set of arguments for both halves of the slot, for the reason the reminder branch
      // gives below: the day is read once and both sweeps see the same workspaces on it.
      const args = await recurringCronArgs(env, logger)

      const recurring = await runRecurringHourly(args)
      logger.info('recurring hourly sweep finished', { ...recurring })

      // Budget periods are materialised here because `12-S2` puts them on this branch, and
      // because the alternative — materialising only when somebody edits a budget — leaves an
      // untouched budget with no period covering today the moment its current one ends.
      const periods = await runBudgetPeriodSweep(args)
      logger.info('budget period sweep finished', { ...periods })
      return
    }

    if (controller.cron === REMINDER_CRON) {
      // One set of arguments for both halves of the slot: the day is read once, the scope list is
      // queried once, and the two sweeps see exactly the same workspaces on the same date.
      const args = await recurringCronArgs(env, logger)

      const reminders = await runRecurringReminderSweep(args)
      logger.info('recurring reminder sweep finished', { ...reminders })

      // `MarkerStore` and `ThresholdMarkerStore` are the same two methods declared in two domains
      // that deliberately do not depend on each other, so the KV store satisfies both structurally.
      const thresholds = await runBudgetThresholdSweep(args)
      logger.info('budget threshold sweep finished', { ...thresholds })

      // Returned, not fallen through: this slot now has handlers, and reaching the warning below
      // would report the tag reminders that are still owed as if nothing in the slot had run.
      return
    }

    logger.warn('cron has no handler yet', {
      cron: controller.cron,
      pending,
      scheduledTime: controller.scheduledTime,
    })
    return Promise.resolve()
  },
}

/**
 * What both recurring branches need, built once from the environment.
 *
 * The database comes from {@link dbFromEnv}, not from the isolate singleton in
 * `src/server/auth/db.ts`: that one reads its binding through `cloudflare:workers`, which is the
 * ambient **request** environment, and a cron is not serving a request. The `env` handed to
 * `scheduled` is the one that is real here, exactly as it is for a Durable Object's own turn.
 *
 * `listCronScopes` builds one scope per workspace with its owner as the principal, so every row
 * either branch touches goes through the same tenant predicate a request would. There is no cron
 * super-user that can see across workspaces.
 *
 * The day is read **once**, here, and passed down; nothing below reads a clock. That is what makes
 * the whole path testable at a pinned date.
 */
async function recurringCronArgs(
  env: Cloudflare.Env,
  logger: Logger,
): Promise<RecurringCronArgs> {
  return {
    scopes: await listCronScopes(dbFromEnv(env)),
    markers: createKvMarkerStore(env.KV),
    today: cronToday(),
    logger,
  }
}
