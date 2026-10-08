/**
 * The ledger read behind `loadTransactions`, for a scope that has already been established.
 *
 * It is the body of that server function and nothing else: the page, the count and the totals over
 * the same query arguments. It resolves no scope of its own and calls `requireOrg` nowhere, so the
 * only way to a `TenantScope` stays the door that called it. There are two such doors -
 * `loadTransactions`, and the planned screen's `loadPlannedScreen`, which proves membership once
 * and hands that one scope to this and to the expected-periods read - and a third caller adds a
 * `requireOrg()` of its own rather than an option here that skips it.
 *
 * **This module is not in the client graph, and must not become part of it.** The Start plugin
 * strips a server function's handler body and the imports that go with it; a plain export reached
 * from anywhere else would bring the repositories into the browser bundle. Import it only from
 * inside a handler (or, for the composition that takes it as a dependency, from the handler that
 * passes it in).
 */

import {
  countTransactions,
  pageTransactions,
  sumTransactions,
} from '#/server/repos/transaction-queries'
import { conversionContextFor } from '#/server/repos/workspace-currencies'

import type { TenantScope } from '#/server/repos/base'
import type {
  TransactionFilters,
  TransactionPage,
  TransactionSort,
  TransactionTotals,
} from '#/server/repos/transaction-queries'
import type { TransactionPolicies } from '#/server/repos/transactions'

/** The validated input of the ledger read: shape only, never a scope, an organisation id or a day. */
export interface LedgerPageInput {
  readonly policies: TransactionPolicies
  readonly filters: TransactionFilters
  readonly sort: TransactionSort
  readonly cursor: string | null
  readonly limit?: number
  /** The per-account passbook asks for the balance-after column; the all-accounts ledger does not. */
  readonly includeBalanceAfter?: boolean
}

export interface TransactionListPage extends TransactionPage {
  /** How many rows match, over the whole filtered set rather than this page. */
  readonly total: number
  /** Income, expense and net over the whole filtered set, in the base currency. */
  readonly totals: TransactionTotals
}

/**
 * One page of the ledger, with the totals under it.
 *
 * The totals are computed over the **whole filtered set**, not the page: a footer that only sums
 * what is on screen changes every time somebody scrolls, and is worse than no footer at all.
 *
 * `historyFloor` is `null` here, which the repository reads as "no ceiling in force" and reports as
 * no clamp. The ceiling itself is a plan entitlement (`analyticsHistoryMonths`) resolved by the
 * billing layer; it is passed through this one argument, so turning it on is a change at this call
 * site and nowhere else.
 */
export async function ledgerPageFor(
  scope: TenantScope,
  input: LedgerPageInput,
): Promise<TransactionListPage> {
  const conversion = await conversionContextFor(scope)
  const query = {
    scope,
    policies: input.policies,
    filters: input.filters,
    historyFloor: null,
  }

  const [page, total, totals] = await Promise.all([
    pageTransactions({
      ...query,
      sort: input.sort,
      cursor: input.cursor,
      limit: input.limit,
      includeBalanceAfter: input.includeBalanceAfter,
    }),
    countTransactions(query),
    sumTransactions({
      ...query,
      baseCurrencyCode: conversion.baseCurrencyCode,
    }),
  ])

  return { ...page, total, totals }
}
