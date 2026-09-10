/**
 * The notification kind registry: one entry per occasion the product can tell somebody about.
 *
 * **Adding a notification is one entry here plus two catalogue keys, and nothing else.** Nothing
 * else in the system enumerates kinds: `notify()` types its `kind` parameter from this registry, so
 * an unregistered kind is a compile error rather than a runtime branch, and the payload type of one
 * kind cannot be passed where another's is expected.
 *
 * **The ids are not declared here.** They live in `#/lib/enums` as `NOTIFICATION_KIND_IDS`, because
 * `#/server/db/schema` builds a SQL `CHECK` from that tuple and importing this module from the
 * schema would close a cycle back through the budget repository. And the *values* are not invented
 * in either place: each one is already exported as a `*_EVENT` constant by the module that decides
 * the occasion happened. `__tests__/kinds.test.ts` welds the three together, so a rename anywhere
 * fails at the seam.
 *
 * **A payload carries integers and codes, never a rendered string.** `docs/MONEY.md`: an amount is
 * an integer number of minor units at its own currency's `digits` scale. A stored `"1 234,56 zł"`
 * cannot be re-rendered for a Polish member of an English-preferring household, which is precisely
 * the reader this product has.
 *
 * **Every payload carries `v`, and the schemas widen only.** Stored rows outlive the code that
 * wrote them; `BACKWARD_COMPATIBILITY.md` treats stored import presets the same way. A narrowing is
 * a new kind id, not an edit to an existing schema.
 */

import { z } from 'zod'

import {
  BUDGET_EXCEEDED_EVENT,
  BUDGET_THRESHOLD_EVENT,
} from '#/server/budgets/thresholds'
import { GOAL_REACHED_EVENT } from '#/server/goals/reached'
import {
  RECURRING_DUE_SOON_EVENT,
  RECURRING_OVERDUE_EVENT,
} from '#/server/recurring/reminders'

import type { NotificationKind } from '#/lib/enums'

export type { NotificationKind }

/** An amount, as it survives a JSON round trip: an integer in its currency's own scale. */
const minor = z.number().int()

/** An ISO-4217 alphabetic code. */
const currency = z.string().length(3)

/** A UTC calendar date, `YYYY-MM-DD`. */
const day = z.string().length(10)

const identifier = z.string().trim().min(1).max(64)

/** The schema version every payload carries. See the module docblock. */
const v = z.literal(1)

const budgetThresholdPayload = z.object({
  v,
  budgetId: identifier,
  budgetName: z.string(),
  periodStart: day,
  /** The configured percentage that was reached. */
  threshold: z.number().int(),
  spentMinor: minor,
  /** `limit + carriedIn`, floored at zero — what the percentage is a percentage *of*. */
  availableMinor: minor,
  currencyCode: currency,
})

const budgetExceededPayload = budgetThresholdPayload.extend({
  /**
   * `spent − available`, as a positive magnitude. The name carries the sign so the template does
   * not have to, and it is the same quantity `#/server/budgets/utilisation` calls `overspentMinor`.
   */
  overspentMinor: minor,
})

const recurringDuePayload = z.object({
  v,
  seriesId: identifier,
  seriesName: z.string(),
  periodStart: day,
  dueOn: day,
  expectedAmountMinor: minor,
  expectedCurrencyCode: currency,
  /** The lead-time offset that produced the reminder, e.g. `3d`; `overdue` for a late one. */
  offset: z.string(),
})

const goalReachedPayload = z.object({
  v,
  goalId: identifier,
  name: z.string(),
  targetMinor: minor,
  contributedMinor: minor,
  currencyCode: currency,
  /** The transaction whose link crossed the line, so the reader can be pointed at it. */
  transactionId: identifier,
})

/** What a person hears about a kind before they have said anything about it. */
export interface ChannelDefaults {
  readonly inApp: boolean
  readonly email: boolean
  readonly digest: boolean
}

export interface NotificationKindEntry<S extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly payload: S
  readonly defaults: ChannelDefaults
  readonly titleKey: string
  readonly bodyKey: string
  /** Where the reader is taken. A function of the payload, so no route is spelled twice. */
  readonly deepLink: (payload: z.infer<S>) => string
  /**
   * Whether this occasion may wait for the nightly digest.
   *
   * `false` means immediate: an envelope that is spent and a bill that is already late are the two
   * things somebody can still act on today, and batching them until 03:00 tomorrow removes the
   * only reason to send them.
   */
  readonly digestible: boolean
}

const ALL_ON: ChannelDefaults = { inApp: true, email: true, digest: true }
const IMMEDIATE: ChannelDefaults = { inApp: true, email: true, digest: false }

export const NOTIFICATION_KINDS = {
  [BUDGET_THRESHOLD_EVENT]: {
    payload: budgetThresholdPayload,
    defaults: ALL_ON,
    titleKey: 'notifications.kind.budgetThresholdCrossed.title',
    bodyKey: 'notifications.kind.budgetThresholdCrossed.body',
    deepLink: (p) => `/budgets/${p.budgetId}`,
    digestible: true,
  } satisfies NotificationKindEntry<typeof budgetThresholdPayload>,
  [BUDGET_EXCEEDED_EVENT]: {
    payload: budgetExceededPayload,
    defaults: IMMEDIATE,
    titleKey: 'notifications.kind.budgetExceeded.title',
    bodyKey: 'notifications.kind.budgetExceeded.body',
    deepLink: (p) => `/budgets/${p.budgetId}`,
    digestible: false,
  } satisfies NotificationKindEntry<typeof budgetExceededPayload>,
  [RECURRING_DUE_SOON_EVENT]: {
    payload: recurringDuePayload,
    defaults: ALL_ON,
    titleKey: 'notifications.kind.recurringDueSoon.title',
    bodyKey: 'notifications.kind.recurringDueSoon.body',
    deepLink: (p) => `/recurring/${p.seriesId}`,
    digestible: true,
  } satisfies NotificationKindEntry<typeof recurringDuePayload>,
  [RECURRING_OVERDUE_EVENT]: {
    payload: recurringDuePayload,
    defaults: IMMEDIATE,
    titleKey: 'notifications.kind.recurringOverdue.title',
    bodyKey: 'notifications.kind.recurringOverdue.body',
    deepLink: (p) => `/recurring/${p.seriesId}`,
    digestible: false,
  } satisfies NotificationKindEntry<typeof recurringDuePayload>,
  [GOAL_REACHED_EVENT]: {
    payload: goalReachedPayload,
    defaults: ALL_ON,
    titleKey: 'notifications.kind.goalReached.title',
    bodyKey: 'notifications.kind.goalReached.body',
    deepLink: (p) => `/goals/${p.goalId}`,
    digestible: true,
  } satisfies NotificationKindEntry<typeof goalReachedPayload>,
} as const

/** The payload a kind carries, inferred from that kind's own schema. */
export type NotificationPayload<K extends NotificationKind> = z.infer<
  (typeof NOTIFICATION_KINDS)[K]['payload']
>

/** The entry for a kind. The parameter type is what makes an unregistered kind a compile error. */
export function notificationKind<K extends NotificationKind>(
  kind: K,
): (typeof NOTIFICATION_KINDS)[K] {
  return NOTIFICATION_KINDS[kind]
}
