/**
 * One goal, as a card and a detail header read it.
 *
 * The shape of this module is the same as `#/server/budgets/summary`: the repository owns the SQL,
 * this owns the composition, and every figure a screen renders is assembled here once so two
 * surfaces cannot print two different numbers beside each other.
 *
 * ---------------------------------------------------------------------------
 * THE CURRENCY RULE, WHICH IS THE WHOLE REASON THIS FILE HAS TWO SETS OF FIGURES
 * ---------------------------------------------------------------------------
 *
 * **A goal is denominated in its own currency and every headline figure stays there.** Somebody
 * saving €4 000 sees €4 000 and sees their progress in euro; a screen that led with the złoty
 * equivalent would be answering a question they did not ask, at a rate that moves under them.
 *
 * The base-currency line beneath it is **secondary**, and its two halves are found in two
 * different ways on purpose:
 *
 * - **Progress** is the integer `SUM` of the linked transactions' own `ref_amount_minor`. Each was
 *   converted once, at its own `booked_on` rate, and stored. Nothing is recomputed —
 *   `docs/MONEY.md` §3.5 calls a report that recomputes a historical conversion a defect, and this
 *   is precisely the read that would have been one.
 * - **The target** has no history to read, so it is converted **once, at `today`**, and never
 *   stored. When no rate exists the whole base block is `null` and the screen simply does not draw
 *   that line — never `0`, which would read as "nothing", and never a stale figure.
 */

import { ZERO_MINOR, asCurrencyCode, asMinor, ratioOfMinor } from '#/lib/money'
import { daysBetween } from '#/server/ledger/grid'
import {
  contributionTotals,
  listGoals,
  suggestContributions,
} from '#/server/repos/goals'
import { computeRefAmount } from '#/server/repos/transactions'

import type { Minor } from '#/lib/money'
import type { SavingsGoal } from '#/server/db/types'
import type { TenantScope } from '#/server/repos/base'
import type {
  ContributionSuggestion,
  GoalContributionTotals,
} from '#/server/repos/goals'
import type { ConversionContext } from '#/server/repos/transactions'

/** The secondary line: the same goal in the workspace's own money. `null` when no rate exists. */
export interface GoalInBase {
  readonly baseCurrencyCode: string
  /** Converted once, at `today`. Never stored — a stored one is stale the next morning. */
  readonly targetMinor: Minor
  /** Summed from the links' stored `ref_amount_minor`. A historical figure, never recomputed. */
  readonly contributedMinor: Minor
}

/** One goal, with everything a card draws and nothing a card does not. */
export interface GoalSummary {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly currencyCode: string
  readonly targetMinor: Minor
  readonly contributedMinor: Minor
  /** `target − contributed`, floored at zero. What the headline of the meter states. */
  readonly remainingMinor: Minor
  /**
   * `contributed / target`, **display only** — it drives a bar's width and a percentage label and
   * never travels back into an amount, which is the contract `ratioOfMinor` states.
   *
   * `null` only for a target of zero, which the create schema's `positive()` rules out. It is kept
   * as a type so a row written by a future import renders an em dash rather than `0%` — which
   * would read as "no progress" when the truth is "unknown".
   */
  readonly ratio: number | null
  readonly targetDate: string | null
  /**
   * Days from `today` to `targetDate`. Negative once the date has passed. `null` without one.
   *
   * A count rather than a verdict: the *word* the screen shows is chosen from {@link isOverdue}
   * beside it, so the colour is never the only thing that changed.
   */
  readonly daysToTarget: number | null
  /** Past its target date and not reached. The one state that needs a warning and a word. */
  readonly isOverdue: boolean
  /** Where contributions come from. */
  readonly accountId: string | null
  /** Where the money is held. */
  readonly linkedAccountId: string | null
  readonly color: string | null
  readonly icon: string | null
  readonly contributionCount: number
  readonly base: GoalInBase | null
  /** Transfers that look like contributions and have not been counted. Offers, never links. */
  readonly suggestions: ReadonlyArray<ContributionSuggestion>
}

export interface SummariseGoalsArgs {
  readonly scope: TenantScope
  /** The UTC calendar day. Decided by the caller, never read from a clock in here. */
  readonly today: string
  readonly conversion: ConversionContext
  readonly includeArchived?: boolean
}

/**
 * Every goal in the workspace, each with its progress, its base-currency line and its offers.
 *
 * The totals are one grouped query for the whole list; the offers are one query per goal, run in
 * parallel, and only for goals that have both account roles set — the rest have no shape to match
 * and cost nothing.
 */
export async function summariseGoals({
  scope,
  today,
  conversion,
  includeArchived = false,
}: SummariseGoalsArgs): Promise<ReadonlyArray<GoalSummary>> {
  const goals = await listGoals(scope, { includeArchived })
  const totals = await contributionTotals(scope)

  return Promise.all(
    goals.map(async (goal) =>
      buildSummary({
        goal,
        today,
        conversion,
        totals: totals.get(goal.id),
        suggestions:
          goal.accountId === null || goal.linkedAccountId === null
            ? []
            : await suggestContributions(scope, goal.id),
      }),
    ),
  )
}

export interface SummariseGoalArgs {
  readonly scope: TenantScope
  readonly goal: SavingsGoal
  readonly today: string
  readonly conversion: ConversionContext
  readonly totals: GoalContributionTotals | undefined
}

/** One goal, for the detail screen, which has already loaded the row and its offers. */
export async function summariseGoal({
  scope,
  goal,
  today,
  conversion,
  totals,
}: SummariseGoalArgs): Promise<GoalSummary> {
  return buildSummary({
    goal,
    today,
    conversion,
    totals,
    suggestions:
      goal.accountId === null || goal.linkedAccountId === null
        ? []
        : await suggestContributions(scope, goal.id),
  })
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                 */
/* -------------------------------------------------------------------------- */

interface BuildSummaryArgs {
  readonly goal: SavingsGoal
  readonly today: string
  readonly conversion: ConversionContext
  readonly totals: GoalContributionTotals | undefined
  readonly suggestions: ReadonlyArray<ContributionSuggestion>
}

async function buildSummary({
  goal,
  today,
  conversion,
  totals,
  suggestions,
}: BuildSummaryArgs): Promise<GoalSummary> {
  const remaining = Math.max(goal.targetMinor - goal.contributedMinor, 0)
  const daysToTarget =
    goal.targetDate === null ? null : daysBetween(today, goal.targetDate)

  return {
    id: goal.id,
    name: goal.name,
    status: goal.status,
    currencyCode: goal.currencyCode,
    targetMinor: goal.targetMinor,
    contributedMinor: goal.contributedMinor,
    remainingMinor: asMinor(remaining),
    ratio: ratioOfMinor(goal.contributedMinor, goal.targetMinor),
    targetDate: goal.targetDate,
    daysToTarget,
    isOverdue:
      goal.status !== 'reached' &&
      goal.status !== 'archived' &&
      daysToTarget !== null &&
      daysToTarget < 0,
    accountId: goal.accountId,
    linkedAccountId: goal.linkedAccountId,
    color: goal.color,
    icon: goal.icon,
    contributionCount: totals?.count ?? 0,
    base: await baseFigures(goal, totals, today, conversion),
    suggestions,
  }
}

/**
 * The secondary line, or `null`.
 *
 * A goal already denominated in the base currency gets its own integers back with no resolver
 * consulted at all — the identity case is not a conversion. Everything else needs a rate for the
 * target, and a missing rate answers `null` rather than throwing: a screen full of goals must not
 * go down because one currency has no quote today.
 */
async function baseFigures(
  goal: SavingsGoal,
  totals: GoalContributionTotals | undefined,
  today: string,
  conversion: ConversionContext,
): Promise<GoalInBase | null> {
  const contributedMinor = totals?.refTotalMinor ?? ZERO_MINOR

  if (goal.currencyCode === conversion.baseCurrencyCode) return null

  try {
    const converted = await computeRefAmount(
      {
        amountMinor: goal.targetMinor,
        currencyCode: asCurrencyCode(goal.currencyCode),
        bookedOn: today,
      },
      conversion,
    )
    return {
      baseCurrencyCode: conversion.baseCurrencyCode,
      targetMinor: converted.refAmountMinor,
      contributedMinor,
    }
  } catch {
    return null
  }
}
