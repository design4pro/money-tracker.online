/**
 * Installs the notification-email enqueuer. Imported for its side effect only.
 *
 * Unsubscribe and the recipient-hash salt have to exist before anything is queued: a message
 * without a signed way out, or a hash written under no key, is mail we cannot stop and cannot
 * correlate with a bounce. Unset, this module logs why and leaves the named no-op in place.
 *
 * Bindings are read inside the installed function, not at module load — they exist only inside a
 * request or a scheduled invocation.
 */

import { env } from 'cloudflare:workers'

import { setNotificationEmailEnqueuer } from '#/server/notify/email'
import { loggerFromEnv } from '#/server/observability/logger'

import {
  WORKSPACE_DAILY_EMAIL_CAP,
  createNotificationEmailEnqueuer,
  notificationEmailInstallGap,
} from './enqueue'
import { emailHashSalt, unsubscribeKeys } from './env'

const logger = loggerFromEnv(env, {
  context: { component: 'worker', route: 'notify.email' },
})

const gap = notificationEmailInstallGap(
  unsubscribeKeys()?.current ?? null,
  emailHashSalt(),
)

if (gap) {
  logger.warn('notification email enqueuer not installed', {
    reason: gap,
  })
} else {
  setNotificationEmailEnqueuer(
    createNotificationEmailEnqueuer({
      send: async (message) => {
        await env.TASKS.send(message)
      },
      now: () => new Date(),
      logger,
      dailyCap: WORKSPACE_DAILY_EMAIL_CAP,
    }),
  )
}
