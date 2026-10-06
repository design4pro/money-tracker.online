/**
 * Which handler runs for which task kind.
 *
 * One entry per kind in the envelope union (`../messages`), typed so that a kind added there fails
 * to compile until it has a handler here. A plan that owns a job kind adds one handler file and
 * replaces its `notInstalled` entry; `worker.ts` and `../dispatch` stay untouched.
 */

import { handleBillingEvent } from './billing-event'
import { notInstalled } from './not-installed'

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
  'import.parse': notInstalled('import.parse'),
  'import.execute': notInstalled('import.execute'),
  'import.revert': notInstalled('import.revert'),
  'export.build': notInstalled('export.build'),
  'backup.run': notInstalled('backup.run'),
}
