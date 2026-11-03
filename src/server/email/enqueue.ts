/**
 * The real notification-email enqueuer: a delivery row, then a `notify.email` queue message.
 *
 * It does not send. Composing needs a locale, an address and templates, which the queue handler
 * already owns. The daily cap is an abuse brake, not a plan limit: over it, Phase 4 writes
 * `failed` / `capped` and enqueues nothing. Phase 5 switches that branch to `deferred`.
 *
 * **Not a money surface.** The queue message is ids only. Amounts stay on the in-app row.
 */

import { insertDelivery, countSince } from '#/server/repos/email-deliveries'

import type { NotificationEmailEnqueuer } from '#/server/notify/email'
import type { Logger } from '#/server/observability/logger'
import type { NotifyEmailMessage } from '#/server/queue/messages'

/** Per-workspace deliveries in one UTC day before immediates stop going on the queue. */
export const WORKSPACE_DAILY_EMAIL_CAP = 200

export interface NotifyEmailSender {
  send: (message: NotifyEmailMessage) => Promise<void>
}

export interface NotificationEmailEnqueuerDeps {
  readonly send: NotifyEmailSender['send']
  readonly now: () => Date
  readonly logger: Logger
  /** Tests pin a small number; production passes {@link WORKSPACE_DAILY_EMAIL_CAP}. */
  readonly dailyCap?: number
}

function utcDayStart(now: Date): Date {
  const utc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  return new Date(utc)
}

function capLogKey(organizationId: string, now: Date): string {
  return `${organizationId}:${utcDayStart(now).toISOString().slice(0, 10)}`
}

/** Secret names that block install, joined, or `null` when both are present. */
export function notificationEmailInstallGap(
  unsubscribeSecret: string | null,
  hashSalt: string | null,
): string | null {
  const missing: Array<string> = []
  if (!unsubscribeSecret) missing.push('UNSUBSCRIBE_TOKEN_SECRET')
  if (!hashSalt) missing.push('EMAIL_HASH_SALT')
  return missing.length === 0 ? null : missing.join(',')
}

export function createNotificationEmailEnqueuer(
  deps: NotificationEmailEnqueuerDeps,
): NotificationEmailEnqueuer {
  const dailyCap = deps.dailyCap ?? WORKSPACE_DAILY_EMAIL_CAP
  const capLogged = new Set<string>()

  return async (scope, args) => {
    const now = deps.now()
    const since = utcDayStart(now)
    const used = await countSince(scope, since)
    const overCap = used >= dailyCap
    const row = await insertDelivery(
      scope,
      {
        userId: args.userId,
        kind: args.kind,
        notificationId: args.notificationId,
        dedupeKey: `notification:${args.notificationId}`,
        status: overCap ? 'failed' : 'queued',
        errorCode: overCap ? 'capped' : undefined,
      },
      now,
    )
    if (row === null) return

    if (overCap) {
      const key = capLogKey(scope.ctx.organizationId, now)
      if (!capLogged.has(key)) {
        capLogged.add(key)
        deps.logger.error('workspace daily email cap reached', undefined, {
          organizationId: scope.ctx.organizationId,
        })
      }
      return
    }

    await deps.send({
      kind: 'notify.email',
      organizationId: scope.ctx.organizationId,
      deliveryId: row.id,
    })
  }
}
