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

import { AccountLedger as LedgerObject } from './do/ledger'
import { SandcastleRegistry as RegistryObject } from './do/sandcastle-registry'
import { loggerFromEnv } from './observability/logger'

import type { Logger } from './observability/logger'

/**
 * Re-exported so `durable_objects.bindings[].class_name` resolves on every environment.
 *
 * The class is declared against narrow port interfaces (`AccountLedgerState`,
 * `AccountLedgerStorage`) rather than against `DurableObjectState`, which is what lets it be
 * constructed with fakes in a plain Node test. A real `DurableObjectState` satisfies those ports
 * structurally; the two descriptions are of the same runtime object and only the static types
 * cannot see it, so this alias is the one place they meet.
 */
export const AccountLedger = LedgerObject

/**
 * Re-exported for the same reason, and bound on **staging only** (`env.staging` in
 * `wrangler.jsonc`). A run coordinator is worth having only if there is exactly one of it; a
 * second registry would let two agent fleets each believe they hold the backlog, which is the
 * failure it exists to prevent. Exporting the class unconditionally costs nothing — an
 * environment with no binding simply never instantiates it — and keeping the export conditional
 * is not expressible in an ES module anyway.
 */
export const SandcastleRegistry = RegistryObject

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
  [REMINDER_CRON]:
    'recurring due sweep, budget threshold alerts, tag reminders',
  [RECURRING_CRON]: 'recurring auto-record materialisation',
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

    logger.warn('cron has no handler yet', {
      cron: controller.cron,
      pending,
      scheduledTime: controller.scheduledTime,
    })
    return Promise.resolve()
  },
}
