/**
 * How much of each metered resource a workspace currently holds.
 *
 * One module, because "42 of 50 accounts" and "may this workspace create another account" must be
 * the **same** number. Two counting paths drift the moment one of them learns about archived rows
 * and the other does not, and the reader who is refused a create while the meter reads 12 of 25
 * has no way to tell which half is lying.
 *
 * Every count here goes through the tenant-scoped base like every other read in this directory, so
 * a foreign row is absent from a meter exactly as it is absent from a list.
 *
 * **What each metric counts, stated once**, because the semantics are the interesting part and
 * they live at the call sites otherwise:
 *
 * - `members` — accepted memberships **plus pending invitations**. Counting only accepted members
 *   lets a five-seat workspace hold twenty outstanding invites and fill them all at once.
 * - `accounts`, `budgets`, `goals`, `rules`, `recurringSeries`, `loans` — every row, archived,
 *   paused, settled and closed included: a ceiling that archiving resets is not a ceiling.
 * - `currencies` — the workspace's held currencies, the base one among them.
 * - `transactions` — every row, planned included.
 * - `importsPerMonth` — batches created since the first of the current UTC month, which is the
 *   window `imports.ts` already meters against.
 * - `storageBytes` — the sum of `attachments.byte_size`, an integer count of bytes.
 */

import { eq } from 'drizzle-orm'

import { invitation, member } from '#/server/db/auth-schema'
import {
  accounts,
  budgets,
  loans,
  organizationCurrencies,
  recurringSeries,
  rules,
  savingsGoals,
  transactions,
} from '#/server/db/schema'
import { QUOTA_METRICS } from '#/lib/plans'

import { createTenantTableAccess } from './base'
import { storedBytes } from './attachments'
import { importsThisMonth } from './imports'

import type { QuotaMetric } from '#/lib/plans'
import type { TenantScope } from './base'

/** Current holdings for every metric the catalogue sells. Total by construction. */
export type WorkspaceUsage = Readonly<Record<QuotaMetric, number>>

const memberAccess = createTenantTableAccess(member, 'member')
const invitationAccess = createTenantTableAccess(invitation, 'invitation')
const accountAccess = createTenantTableAccess(accounts, 'account')
const currencyAccess = createTenantTableAccess(
  organizationCurrencies,
  'workspace currency',
)
const budgetAccess = createTenantTableAccess(budgets, 'budget')
const goalAccess = createTenantTableAccess(savingsGoals, 'savings goal')
const ruleAccess = createTenantTableAccess(rules, 'rule')
const seriesAccess = createTenantTableAccess(
  recurringSeries,
  'recurring series',
)
const loanAccess = createTenantTableAccess(loans, 'loan')
const transactionAccess = createTenantTableAccess(transactions, 'transaction')

/**
 * Seats in use: memberships plus invitations that could still be accepted.
 *
 * Exported because the members repository meters against exactly this number before it writes an
 * invitation, and the billing screen renders exactly this number beside the ceiling.
 */
export async function seatsInUse(scope: TenantScope): Promise<number> {
  const [members, pending] = await Promise.all([
    memberAccess.count(scope),
    invitationAccess.count(scope, eq(invitation.status, 'pending')),
  ])
  return members + pending
}

/** One metric, counted. The resolver's per-check path, and the cheapest thing it can ask for. */
export async function countMetric(
  scope: TenantScope,
  metric: QuotaMetric,
): Promise<number> {
  switch (metric) {
    case 'members':
      return seatsInUse(scope)
    case 'accounts':
      return accountAccess.count(scope)
    case 'currencies':
      return currencyAccess.count(scope)
    case 'budgets':
      return budgetAccess.count(scope)
    case 'goals':
      return goalAccess.count(scope)
    case 'rules':
      return ruleAccess.count(scope)
    case 'recurringSeries':
      return seriesAccess.count(scope)
    case 'loans':
      return loanAccess.count(scope)
    case 'transactions':
      return transactionAccess.count(scope)
    case 'importsPerMonth':
      return importsThisMonth(scope)
    case 'storageBytes':
      return storedBytes(scope)
  }
}

/**
 * Every metric at once, for the screen that renders all of them.
 *
 * Issued in parallel: they are independent reads and the billing screen waits on the slowest one
 * either way. `Object.fromEntries` is typed back into the total record because the input is
 * {@link QUOTA_METRICS} itself — the same tuple the type is derived from.
 */
export async function countUsage(scope: TenantScope): Promise<WorkspaceUsage> {
  const counted = await Promise.all(
    QUOTA_METRICS.map(
      async (metric) => [metric, await countMetric(scope, metric)] as const,
    ),
  )
  return Object.fromEntries(counted) as WorkspaceUsage
}
