/**
 * The weld between three places that must agree on what a notification kind is called.
 *
 * The producing modules own the constants; `#/lib/enums` owns the vocabulary the SQL `CHECK` is
 * built from; the registry owns everything else about a kind. Nothing forces those three to agree
 * at compile time — a string literal will satisfy any of them — so this file is what does it. A
 * rename on any side fails here rather than becoming a row the database rejects at 03:15.
 */

import { describe, expect, it } from 'vitest'

import { NOTIFICATION_KIND_IDS } from '#/lib/enums'
import {
  BUDGET_EXCEEDED_EVENT,
  BUDGET_THRESHOLD_EVENT,
} from '#/server/budgets/thresholds'
import { GOAL_REACHED_EVENT } from '#/server/goals/reached'
import { NOTIFICATION_KINDS } from '#/server/notify/kinds'
import {
  RECURRING_DUE_SOON_EVENT,
  RECURRING_OVERDUE_EVENT,
} from '#/server/recurring/reminders'

import enMessages from '#/lib/i18n/messages/en'
import plMessages from '#/lib/i18n/messages/pl'

describe('the notification kind vocabulary', () => {
  it('names exactly the occasions the producing modules export', () => {
    expect([...NOTIFICATION_KIND_IDS].sort()).toStrictEqual(
      [
        BUDGET_THRESHOLD_EVENT,
        BUDGET_EXCEEDED_EVENT,
        RECURRING_DUE_SOON_EVENT,
        RECURRING_OVERDUE_EVENT,
        GOAL_REACHED_EVENT,
      ].sort(),
    )
  })

  it('is exactly what the registry holds entries for, in both directions', () => {
    expect(Object.keys(NOTIFICATION_KINDS).sort()).toStrictEqual(
      [...NOTIFICATION_KIND_IDS].sort(),
    )
  })
})

describe('every registry entry', () => {
  const kinds = NOTIFICATION_KIND_IDS

  it.each(kinds)('%s names copy that exists in both locales', (kind) => {
    const entry = NOTIFICATION_KINDS[kind]
    for (const key of [entry.titleKey, entry.bodyKey]) {
      expect(enMessages, `${key} is missing from en`).toHaveProperty(key)
      expect(plMessages, `${key} is missing from pl`).toHaveProperty(key)
    }
  })

  it.each(kinds)('%s rejects a payload without its version', (kind) => {
    expect(NOTIFICATION_KINDS[kind].payload.safeParse({}).success).toBe(false)
  })
})
