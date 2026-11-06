/**
 * The nightly summary: one digest mail per member who has something to hear about.
 *
 * When the provider is configured, each digest is a `email_deliveries` row and a `notify.email`
 * message — the same send path as an immediate. When it is not, the sweep logs counts and writes
 * nothing (no staging-stripped body).
 */

import { selectDigestContent } from '#/server/email/digest-items'
import { insertDelivery, markDelivery } from '#/server/repos/email-deliveries'
import { listMembers } from '#/server/repos/members'

import type { Logger } from '#/server/observability/logger'
import type { NotifyEmailMessage } from '#/server/queue/messages'
import type { TenantScope } from '#/server/repos/base'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFERRED_TTL_MS = 48 * 60 * 60 * 1000

export interface DigestCronArgs {
  readonly scopes: ReadonlyArray<TenantScope>
  readonly now: Date
  readonly logger: Logger
  readonly send: (message: NotifyEmailMessage) => Promise<void>
  readonly hasProvider: boolean
}

export interface DigestCronReport {
  readonly workspaces: number
  readonly queued: number
  readonly items: number
  readonly dryRun: boolean
  readonly failures: number
}

function digestDedupeKey(now: Date): string {
  return `digest:${now.toISOString().slice(0, 10)}`
}

export async function runDigest(
  args: DigestCronArgs,
): Promise<DigestCronReport> {
  let queued = 0
  let items = 0
  let failures = 0
  const dryRun = !args.hasProvider
  const unreadSince = new Date(args.now.getTime() - DAY_MS)
  const deferredSince = new Date(args.now.getTime() - DEFERRED_TTL_MS)
  const dedupeKey = digestDedupeKey(args.now)

  for (const scope of args.scopes) {
    try {
      const members = await listMembers(scope)
      for (const member of members) {
        const selection = await selectDigestContent(
          scope,
          member.userId,
          unreadSince,
          deferredSince,
        )
        items += selection.lines.length

        if (dryRun) continue

        for (const row of selection.deferredUnsubscribed) {
          await markDelivery(
            scope,
            row.id,
            { status: 'failed', errorCode: 'unsubscribed' },
            'deferred',
          )
        }
        for (const row of selection.deferredGone) {
          await markDelivery(
            scope,
            row.id,
            { status: 'failed', errorCode: 'gone' },
            'deferred',
          )
        }

        if (selection.lines.length === 0) continue

        const delivery = await insertDelivery(
          scope,
          {
            userId: member.userId,
            kind: 'digest',
            notificationId: null,
            dedupeKey,
            status: 'queued',
          },
          args.now,
        )
        if (delivery === null) continue

        await args.send({
          kind: 'notify.email',
          organizationId: scope.ctx.organizationId,
          deliveryId: delivery.id,
        })
        queued += 1
      }
    } catch (error) {
      failures += 1
      args.logger.error('digest sweep failed for a workspace', error, {
        organizationId: scope.ctx.organizationId,
      })
    }
  }

  if (dryRun) {
    args.logger.info('digest dry run', {
      workspaces: args.scopes.length,
      items,
    })
  }

  return {
    workspaces: args.scopes.length,
    queued,
    items,
    dryRun,
    failures,
  }
}
