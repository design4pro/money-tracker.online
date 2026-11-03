/**
 * The in-app path a notification kind points at, from its stored payload.
 *
 * Shared by the immediate mail handler and the digest so a kind's `deepLink` is spelled once.
 * `null` means the payload is not this kind's schema — the caller skips that row rather than
 * inventing a URL.
 */

import { NOTIFICATION_KINDS } from '#/server/notify/kinds'

import type { NotificationKind } from '#/lib/enums'

export function deepLinkPath(
  kind: NotificationKind,
  payload: unknown,
): string | null {
  switch (kind) {
    case 'budget.threshold_crossed': {
      const parsed = NOTIFICATION_KINDS[kind].payload.safeParse(payload)
      return parsed.success
        ? NOTIFICATION_KINDS[kind].deepLink(parsed.data)
        : null
    }
    case 'budget.exceeded': {
      const parsed = NOTIFICATION_KINDS[kind].payload.safeParse(payload)
      return parsed.success
        ? NOTIFICATION_KINDS[kind].deepLink(parsed.data)
        : null
    }
    case 'recurring.due_soon':
    case 'recurring.overdue': {
      const parsed = NOTIFICATION_KINDS[kind].payload.safeParse(payload)
      return parsed.success
        ? NOTIFICATION_KINDS[kind].deepLink(parsed.data)
        : null
    }
    case 'goal.reached': {
      const parsed = NOTIFICATION_KINDS[kind].payload.safeParse(payload)
      return parsed.success
        ? NOTIFICATION_KINDS[kind].deepLink(parsed.data)
        : null
    }
  }
}
