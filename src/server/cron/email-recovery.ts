/**
 * Puts stale notification-email deliveries back on the queue, or expires them.
 *
 * A Worker that dies between `queued → sending` and `sent` leaves a row that a redelivered
 * message will not claim. After 15 minutes this sweep writes it `queued` again and enqueues the
 * same delivery id, so the handler's `Idempotency-Key` is unchanged. Rows older than 23 hours
 * expire instead: Resend's idempotency window is 24 hours, and a message that arrives a day late
 * is worse than one that does not arrive.
 *
 * No provider configured means no requeue. Expiry still runs, so a key that never arrives does
 * not leave `sending` rows forever.
 *
 * Phase 5 expires `deferred` rows older than 48 hours. This sweep does not.
 */

import { listStale, markDelivery } from '#/server/repos/email-deliveries'

import type { Logger } from '#/server/observability/logger'
import type { NotifyEmailMessage } from '#/server/queue/messages'
import type { TenantScope } from '#/server/repos/base'

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000
const TWENTY_THREE_HOURS_MS = 23 * 60 * 60 * 1000

export interface EmailRecoveryArgs {
  readonly scopes: ReadonlyArray<TenantScope>
  readonly now: Date
  readonly logger: Logger
  readonly send: (message: NotifyEmailMessage) => Promise<void>
  readonly hasProvider: boolean
}

export interface EmailRecoveryReport {
  readonly workspaces: number
  readonly requeued: number
  readonly expired: number
  readonly failures: number
}

export async function runEmailRecovery(
  args: EmailRecoveryArgs,
): Promise<EmailRecoveryReport> {
  let requeued = 0
  let expired = 0
  let failures = 0

  const olderThan = new Date(args.now.getTime() - FIFTEEN_MINUTES_MS)
  const expireBefore = args.now.getTime() - TWENTY_THREE_HOURS_MS

  for (const scope of args.scopes) {
    try {
      const stale = await listStale(scope, olderThan, new Date(0))
      for (const row of stale) {
        if (row.status !== 'queued' && row.status !== 'sending') continue
        if (row.createdAt.getTime() < expireBefore) {
          await markDelivery(
            scope,
            row.id,
            { status: 'failed', errorCode: 'expired' },
            row.status,
          )
          expired += 1
          continue
        }

        if (!args.hasProvider) continue

        if (row.status === 'sending') {
          await markDelivery(scope, row.id, { status: 'queued' }, 'sending')
        }

        await args.send({
          kind: 'notify.email',
          organizationId: scope.ctx.organizationId,
          deliveryId: row.id,
        })
        requeued += 1
      }
    } catch (error) {
      failures += 1
      args.logger.error('email recovery sweep failed for a workspace', error, {
        organizationId: scope.ctx.organizationId,
      })
    }
  }

  return {
    workspaces: args.scopes.length,
    requeued,
    expired,
    failures,
  }
}
