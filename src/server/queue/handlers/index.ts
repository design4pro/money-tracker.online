/**
 * Which handler runs for which task kind.
 *
 * One entry per kind in the envelope union (`../messages`), typed so that a kind added there fails
 * to compile until it has a handler here. A plan that owns a job kind adds one handler file and
 * replaces its entry; `worker.ts` and `../dispatch` stay untouched.
 */

import { handleBillingEvent } from './billing-event'

import type { TaskHandlers } from '../dispatch'

export const taskHandlers: TaskHandlers = {
  'billing.event': async (task, ctx) => {
    const outcome = await handleBillingEvent({
      db: ctx.db,
      eventId: task.eventId,
      now: ctx.now(),
      logger: ctx.logger,
    })
    ctx.logger.debug('queue message handled', { kind: task.kind, outcome })
  },
}
