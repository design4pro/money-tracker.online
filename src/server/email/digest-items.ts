/**
 * Which notifications a digest for one member should name.
 *
 * Unread digestible rows from the last 24 h, when that kind's digest pref is on, plus `deferred`
 * cap rows whose kind still has email on. Email off since the deferral means `unsubscribed`, not
 * a line in the mail. **Not a money surface:** each line is a kind and a path, never a payload.
 */

import { NOTIFICATION_KIND_IDS } from '#/lib/enums'
import { deepLinkPath } from '#/server/email/deep-link'
import { NOTIFICATION_KINDS } from '#/server/notify/kinds'
import { listDeferredSince } from '#/server/repos/email-deliveries'
import {
  getNotification,
  listPrefsFor,
  listUnreadForSince,
  resolvePrefs,
} from '#/server/repos/notifications'

import type { NotificationKind } from '#/lib/enums'
import type { EmailDeliveryRow, NotificationRow } from '#/server/db/schema'
import type { TenantScope } from '#/server/repos/base'

export interface DigestLine {
  readonly kind: NotificationKind
  readonly href: string
  readonly notificationId: string
  readonly createdAt: Date
}

export interface DigestSelection {
  readonly lines: ReadonlyArray<DigestLine>
  readonly deferredKeep: ReadonlyArray<EmailDeliveryRow>
  readonly deferredUnsubscribed: ReadonlyArray<EmailDeliveryRow>
  readonly deferredGone: ReadonlyArray<EmailDeliveryRow>
}

function isNotificationKind(kind: string): kind is NotificationKind {
  return (NOTIFICATION_KIND_IDS as ReadonlyArray<string>).includes(kind)
}

function payloadOf(row: NotificationRow): unknown {
  try {
    return JSON.parse(row.payloadJson)
  } catch {
    return null
  }
}

function lineOf(row: NotificationRow): DigestLine | null {
  if (!isNotificationKind(row.kind)) return null
  const href = deepLinkPath(row.kind, payloadOf(row))
  if (href === null) return null
  return {
    kind: row.kind,
    href,
    notificationId: row.id,
    createdAt: row.createdAt,
  }
}

function kindOrder(kind: NotificationKind): number {
  return NOTIFICATION_KIND_IDS.indexOf(kind)
}

export async function selectDigestContent(
  scope: TenantScope,
  userId: string,
  unreadSince: Date,
  deferredSince: Date,
): Promise<DigestSelection> {
  const prefs = await listPrefsFor(scope, userId)
  const unread = await listUnreadForSince(scope, userId, unreadSince)
  const deferred = (await listDeferredSince(scope, deferredSince)).filter(
    (row) => row.userId === userId,
  )

  const deferredKeep: Array<EmailDeliveryRow> = []
  const deferredUnsubscribed: Array<EmailDeliveryRow> = []
  const deferredGone: Array<EmailDeliveryRow> = []
  const seen = new Set<string>()
  const lines: Array<DigestLine> = []

  for (const delivery of deferred) {
    if (!isNotificationKind(delivery.kind)) {
      deferredGone.push(delivery)
      continue
    }
    const stored = prefs.get(delivery.kind)
    const channels = resolvePrefs(
      stored,
      NOTIFICATION_KINDS[delivery.kind].defaults,
    )
    if (!channels.email) {
      deferredUnsubscribed.push(delivery)
      continue
    }
    if (delivery.notificationId === null) {
      deferredGone.push(delivery)
      continue
    }
    const notification = await getNotification(scope, delivery.notificationId)
    if (!notification) {
      deferredGone.push(delivery)
      continue
    }
    const line = lineOf(notification)
    if (line === null) {
      deferredGone.push(delivery)
      continue
    }
    deferredKeep.push(delivery)
    if (!seen.has(line.notificationId)) {
      seen.add(line.notificationId)
      lines.push(line)
    }
  }

  for (const row of unread) {
    if (!isNotificationKind(row.kind)) continue
    const entry = NOTIFICATION_KINDS[row.kind]
    if (!entry.digestible) continue
    const channels = resolvePrefs(prefs.get(row.kind), entry.defaults)
    if (!channels.digest) continue
    const line = lineOf(row)
    if (line === null) continue
    if (seen.has(line.notificationId)) continue
    seen.add(line.notificationId)
    lines.push(line)
  }

  lines.sort((left, right) => {
    const byKind = kindOrder(left.kind) - kindOrder(right.kind)
    if (byKind !== 0) return byKind
    return left.createdAt.getTime() - right.createdAt.getTime()
  })

  return {
    lines,
    deferredKeep,
    deferredUnsubscribed,
    deferredGone,
  }
}
