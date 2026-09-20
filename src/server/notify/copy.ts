/**
 * Which catalogue keys a notification uses, and what goes in their placeholders.
 *
 * **It formats nothing, and that is the whole point.** Every value it hands back is what the row
 * stores: an integer number of minor units with its currency code, an ISO date, a whole percentage,
 * a name the person typed. Turning any of those into `1 234,56 zł` or `15 March` is the reader's
 * job, because only the reader knows whose locale to use — and this product has households whose
 * members do not share one. A string formatted here would read correctly for whoever the cron
 * happened to be sweeping and wrongly for everybody else, permanently, because it would be what the
 * row said.
 *
 * That is also why it is worth having in a stage with no component. `notificationCopy` is the
 * mapping from a payload to a message's placeholders, and it is testable on its own: the catalogue
 * declares `{spent}`, the payload holds `spentMinor`, and nothing else in this stage would notice
 * if those two stopped agreeing.
 */

import { NOTIFICATION_KINDS } from './kinds'

import type { NotificationKind } from '#/lib/enums'
import type { CopyParam, MoneyParam } from '#/lib/notifications/params'
import type { NotificationPayload } from './kinds'

/**
 * The parameter types are defined in `#/lib/notifications/params` and re-exported here, so this
 * module stays the one import for "what a notification's copy looks like" while the readers that
 * render the bag — `21-S2`'s email templates, `21-S3`'s notification item — can take the shape
 * without taking a dependency on `server/`.
 */
export type { CopyParam, MoneyParam }

export interface NotificationCopy {
  readonly titleKey: string
  readonly bodyKey: string
  readonly params: Readonly<Record<string, CopyParam>>
}

function money(minor: number, currencyCode: string): MoneyParam {
  return { minor, currencyCode }
}

/**
 * The placeholders each kind's two messages declare, filled from that kind's payload.
 *
 * One arm per kind rather than a generic walk over the payload: the placeholder names are the
 * catalogue's (`{spent}`), the field names are the payload's (`spentMinor`), and the mapping
 * between them is a decision per kind rather than a convention a rename would quietly break.
 */
function paramsFor(
  kind: NotificationKind,
  payload: NotificationPayload<NotificationKind>,
): Readonly<Record<string, CopyParam>> {
  switch (kind) {
    case 'budget.threshold_crossed': {
      const p = payload as NotificationPayload<'budget.threshold_crossed'>
      return {
        budget: p.budgetName,
        threshold: p.threshold,
        spent: money(p.spentMinor, p.currencyCode),
        available: money(p.availableMinor, p.currencyCode),
      }
    }
    case 'budget.exceeded': {
      const p = payload as NotificationPayload<'budget.exceeded'>
      return {
        budget: p.budgetName,
        available: money(p.availableMinor, p.currencyCode),
        overspent: money(p.overspentMinor, p.currencyCode),
      }
    }
    case 'recurring.due_soon':
    case 'recurring.overdue': {
      const p = payload as NotificationPayload<'recurring.due_soon'>
      return {
        series: p.seriesName,
        date: p.dueOn,
        amount: money(p.expectedAmountMinor, p.expectedCurrencyCode),
      }
    }
    case 'goal.reached': {
      const p = payload as NotificationPayload<'goal.reached'>
      return {
        goal: p.name,
        contributed: money(p.contributedMinor, p.currencyCode),
        target: money(p.targetMinor, p.currencyCode),
      }
    }
  }
}

export function notificationCopy<TKind extends NotificationKind>(
  kind: TKind,
  payload: NotificationPayload<TKind>,
): NotificationCopy {
  const entry = NOTIFICATION_KINDS[kind]
  return {
    titleKey: entry.titleKey,
    bodyKey: entry.bodyKey,
    params: paramsFor(kind, payload),
  }
}
