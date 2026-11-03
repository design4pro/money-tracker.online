/**
 * Turns one `email_deliveries` row into one sent notification email.
 *
 * Registered as the `notify.email` consumer in this phase; the enqueuer is **not** installed, so
 * no member receives mail until Phase 4. Redelivery is a no-op because the claim is `queued →
 * sending`. The body is event name + deep link only (ADR 0035): amounts never leave the platform.
 */

import { createTranslator, loadCatalogue } from '#/lib/i18n'
import { resolveRecipientLocale } from '#/server/email/locale'
import { hashRecipient } from '#/server/email/recipient-hash'
import { renderEmail } from '#/server/email/render'
import { sendEmail } from '#/server/email/send'
import { notificationEmail } from '#/server/email/templates/notification'
import { NOTIFICATION_KINDS } from '#/server/notify/kinds'
import {
  claimDelivery,
  getDelivery,
  markDelivery,
} from '#/server/repos/email-deliveries'
import { isSuppressed } from '#/server/repos/email-suppressions'
import { isMember, memberEmail, workspaceName } from '#/server/repos/members'
import { getNotification } from '#/server/repos/notifications'
import { ownerScopeFor } from '#/server/repos/subscriptions'

import type { NotificationKind } from '#/lib/enums'
import type { Locale } from '#/lib/i18n'
import type { StoredLocaleSeam } from '#/server/email/locale'
import type { EmailTransport } from '#/server/email/send'
import type { Logger } from '#/server/observability/logger'
import type { Database } from '#/server/repos/base'

export class NotifyEmailRetryError extends Error {
  constructor(message = 'notification email send is retryable') {
    super(message)
    this.name = 'NotifyEmailRetryError'
  }
}

export type NotifyEmailOutcome =
  | 'sent'
  | 'already-handled'
  | 'not-member'
  | 'gone'
  | 'suppressed'
  | 'rejected'
  | 'no-address'
  | 'payload'

export interface NotifyEmailArgs {
  readonly db: Database
  readonly organizationId: string
  readonly deliveryId: string
  readonly now: Date
  readonly logger: Logger
  readonly transport: EmailTransport
  readonly hashSalt: string | null
  readonly appUrl: string
  readonly storedLocale?: StoredLocaleSeam
  readonly locale?: Locale
}

function isNotificationKind(kind: string): kind is NotificationKind {
  return kind in NOTIFICATION_KINDS
}

function absoluteUrl(appUrl: string, path: string): string {
  const origin = appUrl.replace(/\/+$/, '')
  return path.startsWith('/') ? `${origin}${path}` : `${origin}/${path}`
}

function deepLinkOf(kind: NotificationKind, payload: unknown): string {
  switch (kind) {
    case 'budget.threshold_crossed':
      return NOTIFICATION_KINDS[kind].deepLink(
        NOTIFICATION_KINDS[kind].payload.parse(payload),
      )
    case 'budget.exceeded':
      return NOTIFICATION_KINDS[kind].deepLink(
        NOTIFICATION_KINDS[kind].payload.parse(payload),
      )
    case 'recurring.due_soon':
    case 'recurring.overdue':
      return NOTIFICATION_KINDS[kind].deepLink(
        NOTIFICATION_KINDS[kind].payload.parse(payload),
      )
    case 'goal.reached':
      return NOTIFICATION_KINDS[kind].deepLink(
        NOTIFICATION_KINDS[kind].payload.parse(payload),
      )
  }
}

export async function handleNotifyEmail(
  args: NotifyEmailArgs,
): Promise<NotifyEmailOutcome> {
  const scope = await ownerScopeFor(args.db, args.organizationId)
  if (!scope) {
    throw new Error('notify.email organization does not exist')
  }

  const delivery = await getDelivery(scope, args.deliveryId)
  if (!delivery) {
    throw new Error('notify.email delivery does not exist in this workspace')
  }

  if (delivery.organizationId !== args.organizationId) {
    throw new Error('notify.email organizationId disagrees with the row')
  }

  if (delivery.kind === 'digest') {
    throw new Error('digest email is not installed')
  }

  if (!(await isMember(scope, delivery.userId))) {
    await markDelivery(
      scope,
      delivery.id,
      { status: 'failed', errorCode: 'not-member' },
      'queued',
    )
    return 'not-member'
  }

  if (delivery.notificationId === null) {
    await markDelivery(
      scope,
      delivery.id,
      { status: 'failed', errorCode: 'gone' },
      'queued',
    )
    return 'gone'
  }

  const notification = await getNotification(scope, delivery.notificationId)
  if (!notification) {
    await markDelivery(
      scope,
      delivery.id,
      { status: 'failed', errorCode: 'gone' },
      'queued',
    )
    return 'gone'
  }

  const claimed = await claimDelivery(scope, delivery.id)
  if (!claimed) return 'already-handled'

  const address = await memberEmail(scope, claimed.userId)
  if (!address) {
    await markDelivery(
      scope,
      claimed.id,
      { status: 'failed', errorCode: 'no-address' },
      'sending',
    )
    return 'no-address'
  }

  if (!args.hashSalt) {
    args.logger.warn('notification email not sent: EMAIL_HASH_SALT is unset', {
      deliveryId: claimed.id,
    })
    await markDelivery(scope, claimed.id, { status: 'queued' }, 'sending')
    throw new NotifyEmailRetryError()
  }

  const toHash = await hashRecipient(address, args.hashSalt)
  if (await isSuppressed(args.db, toHash)) {
    await markDelivery(
      scope,
      claimed.id,
      { status: 'suppressed', toHash },
      'sending',
    )
    return 'suppressed'
  }

  if (!isNotificationKind(claimed.kind) || claimed.kind !== notification.kind) {
    await markDelivery(
      scope,
      claimed.id,
      { status: 'failed', errorCode: 'payload', toHash },
      'sending',
    )
    return 'payload'
  }

  let payloadJson: unknown
  try {
    payloadJson = JSON.parse(notification.payloadJson)
  } catch {
    await markDelivery(
      scope,
      claimed.id,
      { status: 'failed', errorCode: 'payload', toHash },
      'sending',
    )
    return 'payload'
  }

  const parsed = NOTIFICATION_KINDS[claimed.kind].payload.safeParse(payloadJson)
  if (!parsed.success) {
    await markDelivery(
      scope,
      claimed.id,
      { status: 'failed', errorCode: 'payload', toHash },
      'sending',
    )
    return 'payload'
  }

  const locale =
    args.locale ??
    (await resolveRecipientLocale(scope, claimed.userId, args.storedLocale))
  const t = createTranslator(locale, await loadCatalogue(locale))
  const { subject, element } = notificationEmail(
    {
      kind: claimed.kind,
      locale,
      actionHref: absoluteUrl(
        args.appUrl,
        deepLinkOf(claimed.kind, parsed.data),
      ),
      workspaceName: await workspaceName(scope),
    },
    t,
  )
  const { html, text } = await renderEmail(element)

  const result = await sendEmail(
    {
      to: address,
      subject,
      html,
      text,
      idempotencyKey: claimed.id,
      tags: [
        { name: 'delivery', value: claimed.id },
        { name: 'org', value: args.organizationId },
      ],
    },
    { ...args.transport, kind: claimed.kind },
  )

  if (result.ok) {
    await markDelivery(
      scope,
      claimed.id,
      {
        status: 'sent',
        toHash,
        providerMessageId: result.providerMessageId,
        sentAt: args.now,
      },
      'sending',
    )
    return 'sent'
  }

  if (result.kind === 'rejected') {
    await markDelivery(
      scope,
      claimed.id,
      {
        status: 'failed',
        toHash,
        errorCode:
          result.status === undefined ? 'rejected' : String(result.status),
      },
      'sending',
    )
    return 'rejected'
  }

  args.logger.warn('notification email deferred', {
    deliveryId: claimed.id,
    kind: result.kind,
    status: result.status,
  })
  await markDelivery(scope, claimed.id, { status: 'queued', toHash }, 'sending')
  throw new NotifyEmailRetryError()
}
