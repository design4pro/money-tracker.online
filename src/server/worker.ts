/**
 * The Worker entry point — `main` in `wrangler.jsonc`.
 *
 * TanStack Start's own entry (`@tanstack/react-start/server-entry`) exports only `fetch`. A
 * Worker, though, is the union of everything the configuration declares: this one also declares
 * two Durable Object classes, a queue consumer and four cron triggers, and the runtime can only
 * find those if the **entry module** exports them. Miniflare is blunt about the omission — a
 * missing `AccountLedger` export fails isolate startup outright, so `vite dev` never serves a
 * request, and `wrangler deploy` refuses a migration naming a class it cannot resolve.
 *
 * Hence this module rather than the default entry: it re-creates Start's fetch handler and
 * exports it alongside the classes, the consumer and the scheduler.
 */

import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'

import { drizzle } from 'drizzle-orm/d1'

// Side effect only: installs this isolate's `LEDGER` batch ports. The fetch path reaches them
// through the server functions it loads; a scheduled invocation loads no server function, so
// without this line every rebuild the cron enqueues would be silently dropped and the balances it
// moved would stay stale until the nightly sweep.
import './ledger'

import { runBudgetPeriodSweep } from './cron/budget-periods'
import { runBudgetThresholdSweep } from './cron/budget-thresholds'
import {
  cronToday,
  runRecurringHourly,
  runRecurringReminderSweep,
} from './cron/recurring'
import * as financeSchema from './db/schema'
import { AccountLedger as LedgerObject } from './do/ledger'
import { createKvMarkerStore } from './recurring/markers'
import { rebuildAccountBalance } from './repos/account-balances'
import { listCronScopes } from './repos/recurring'
import { loggerFromEnv } from './observability/logger'

import type { Logger } from './observability/logger'
import type { RecurringCronArgs } from './cron/recurring'
import type { Database } from './repos/base'

/**
 * Exported so `durable_objects.bindings[].class_name` resolves on every environment, and
 * **constructed with its real rebuild port**.
 *
 * `AccountLedger` is declared against narrow port interfaces (`AccountLedgerState`,
 * `AccountLedgerStorage`, `RebuildPort`) rather than against `DurableObjectState`, which is what
 * lets it be constructed with fakes in a plain Node test. A real `DurableObjectState` satisfies
 * those ports structurally; the two descriptions are of the same runtime object and only the
 * static types cannot see it, so this subclass is the one place they meet.
 *
 * The subclass exists for one reason: the runtime instantiates a Durable Object with exactly
 * `(state, env)`, so an injected dependency has nowhere else to enter. Its own docblock said the
 * D1 half would be "passed in here and nothing else changes" once the finance domain landed. It
 * has landed, so it is passed in; without it the object answers `'skipped'` to every rebuild and
 * every account balance in the product stays at zero.
 */
export class AccountLedger extends LedgerObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      rebuild: (accountId) => rebuildAccountBalance(ledgerDb(env), accountId),
    })
  }
}

/**
 * A Drizzle handle over this object's D1 binding.
 *
 * Built per construction rather than reaching `src/server/auth/db.ts`'s isolate singleton: that one
 * reads the binding through `cloudflare:workers`, which is the ambient request environment, and a
 * Durable Object is not serving a request when it rebuilds — it is serving its own turn, with the
 * `env` it was constructed with.
 */
function ledgerDb(env: Env): Database {
  return drizzle(env.DB, {
    schema: financeSchema,
    logger: false,
  }) as unknown as Database
}

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
   * No task kind has a handler yet, so every message is acknowledged with a warn rather than
   * retried: retrying a message nothing can process spends five attempts to reach the
   * dead-letter queue with no more information than the first attempt had. The warn carries the
   * batch's queue name and size, which is what tells you a producer started running before its
   * consumer landed.
   */
  async queue(
    batch: MessageBatch<unknown>,
    env: Cloudflare.Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const logger: Logger = loggerFromEnv(env, {
      context: { component: 'queue', route: batch.queue },
    })

    logger.warn('queue batch has no handler yet', {
      queue: batch.queue,
      messages: batch.messages.length,
    })

    // Acknowledged explicitly rather than by returning: an unacknowledged message is redelivered
    // to a consumer that will make the same non-decision, and `max_retries` of those is the only
    // thing standing between this and a full dead-letter queue.
    batch.ackAll()
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
 * The database comes from {@link ledgerDb}, not from the isolate singleton in
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
    scopes: await listCronScopes(ledgerDb(env)),
    markers: createKvMarkerStore(env.KV),
    today: cronToday(),
    logger,
  }
}
