/**
 * Phase 3 read tools. Each one calls an existing repository (or the ledger
 * page / budget summary already used by the matching server function).
 *
 * `listTools` is the grant's read scopes, not the full catalogue. Write and
 * delete names are refused here so a read-only grant cannot sneak them in
 * before Phase 4 registers handlers.
 */

import { CalendarDate } from '@internationalized/date'
import { z } from 'zod'

import { summariseBudgets } from '#/server/budgets/summary'
import {
  getAccount,
  listAccounts,
  listAccountsSchema,
} from '#/server/repos/accounts'
import { scopesOfGrant } from '#/server/repos/agent-grants'
import { listBudgetsSchema } from '#/server/repos/budgets'
import {
  getCategory,
  listCategories,
  listCategoriesSchema,
} from '#/server/repos/categories'
import { getPayee, listPayees, listPayeesSchema } from '#/server/repos/payees'
import { listSeries, listSeriesSchema } from '#/server/repos/recurring'
import {
  ledgerPageInputSchema,
  sumTransactions,
} from '#/server/repos/transaction-queries'
import { transactionPoliciesSchema } from '#/server/repos/transactions'
import { conversionContextFor } from '#/server/repos/workspace-currencies'
import { ledgerPageFor } from '#/server/transactions/ledger-page'

import {
  isWriteOrDeleteToolName,
  listedReadToolNames,
  scopeForReadTool,
} from './catalog'
import { assertIntegerMinors, toJsonValue } from './json'
import { McpDeniedError, mcpToolErrorResult } from './tool-error'

import type { McpToolErrorKind } from './tool-error'

import type { McpReadToolName } from './catalog'
import type { JsonValue } from './json'
import type { McpServer } from '@modelcontextprotocol/server'
import type { AgentGrantRow } from '#/server/db/schema'
import type { AgentScope } from '#/server/repos/agent-grants'
import type { TenantScope } from '#/server/repos/base'

export interface McpToolContext {
  readonly scopes: ReadonlyArray<AgentScope>
  readonly scope: TenantScope
}

export function toolContextForGrant(
  grant: AgentGrantRow,
  scope: TenantScope,
): McpToolContext {
  return { scopes: scopesOfGrant(grant), scope }
}

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'A calendar month as YYYY-MM')

const getBalancesSchema = z.strictObject({
  accountIds: z.array(z.string().trim().min(1).max(64)).min(1).optional(),
})

const listBudgetsMcpSchema = listBudgetsSchema.extend({
  month: monthSchema,
})

const getMonthSummarySchema = z.strictObject({
  month: monthSchema,
  policies: transactionPoliciesSchema,
})

function monthBounds(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const start = new CalendarDate(year, monthNumber, 1)
  const end = start.add({ months: 1 }).subtract({ days: 1 })
  return { from: start.toString(), to: end.toString() }
}

function requireScope(ctx: McpToolContext, name: string): void {
  const needed = scopeForReadTool(name)
  if (needed === null || !ctx.scopes.includes(needed)) {
    throw new McpDeniedError()
  }
}

async function requireOwnAccounts(
  scope: TenantScope,
  ids: ReadonlyArray<string> | undefined,
): Promise<void> {
  if (ids === undefined) return
  for (const id of ids) await getAccount(scope, id)
}

async function requireOwnCategories(
  scope: TenantScope,
  ids: ReadonlyArray<string> | undefined,
): Promise<void> {
  if (ids === undefined) return
  for (const id of ids) await getCategory(scope, id)
}

async function requireOwnPayees(
  scope: TenantScope,
  ids: ReadonlyArray<string> | undefined,
): Promise<void> {
  if (ids === undefined) return
  for (const id of ids) await getPayee(scope, id)
}

async function runListAccounts(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  return listAccounts(ctx.scope, listAccountsSchema.parse(input ?? {}))
}

async function runGetBalances(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = getBalancesSchema.parse(input ?? {})
  await requireOwnAccounts(ctx.scope, parsed.accountIds)
  const listed = await listAccounts(ctx.scope, {})
  const chosen =
    parsed.accountIds === undefined
      ? listed.accounts
      : listed.accounts.filter((row) => parsed.accountIds!.includes(row.id))
  return {
    accounts: chosen.map((row) => ({
      id: row.id,
      currencyCode: row.currencyCode,
      balanceMinor: row.currentBalanceMinor,
    })),
    overview: listed.overview,
  }
}

async function runListTransactions(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = ledgerPageInputSchema.parse(input)
  await requireOwnAccounts(ctx.scope, parsed.filters.accountIds)
  await requireOwnCategories(ctx.scope, parsed.filters.categoryIds)
  await requireOwnPayees(ctx.scope, parsed.filters.payeeIds)
  return ledgerPageFor(ctx.scope, parsed)
}

async function runListCategories(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  return listCategories(ctx.scope, listCategoriesSchema.parse(input ?? {}))
}

async function runListPayees(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  return listPayees(ctx.scope, listPayeesSchema.parse(input ?? {}))
}

async function runListRecurring(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  return listSeries(ctx.scope, listSeriesSchema.parse(input ?? {}))
}

async function runListBudgets(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = listBudgetsMcpSchema.parse(input)
  const { from } = monthBounds(parsed.month)
  return summariseBudgets({
    scope: ctx.scope,
    today: from,
    conversion: await conversionContextFor(ctx.scope),
    includeArchived: parsed.includeArchived,
  })
}

async function runGetMonthSummary(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = getMonthSummarySchema.parse(input)
  const { from, to } = monthBounds(parsed.month)
  const conversion = await conversionContextFor(ctx.scope)
  return sumTransactions({
    scope: ctx.scope,
    policies: parsed.policies,
    filters: { from, to },
    historyFloor: null,
    baseCurrencyCode: conversion.baseCurrencyCode,
  })
}

const READ_RUNNERS: Record<
  McpReadToolName,
  (ctx: McpToolContext, input: unknown) => Promise<unknown>
> = {
  list_accounts: runListAccounts,
  get_balances: runGetBalances,
  list_transactions: runListTransactions,
  list_categories: runListCategories,
  list_payees: runListPayees,
  list_recurring: runListRecurring,
  list_budgets: runListBudgets,
  get_month_summary: runGetMonthSummary,
}

export type McpToolSuccess = {
  readonly ok: true
  readonly data: JsonValue
}

export type McpToolFailureResult = {
  readonly ok: false
  readonly kind: McpToolErrorKind
}

export async function invokeMcpTool(
  ctx: McpToolContext,
  name: string,
  input: unknown,
): Promise<McpToolSuccess | McpToolFailureResult> {
  try {
    if (isWriteOrDeleteToolName(name)) throw new McpDeniedError()
    requireScope(ctx, name)
    const runner = READ_RUNNERS[name as McpReadToolName]
    if (runner === undefined) throw new McpDeniedError()
    const data = toJsonValue(await runner(ctx, input))
    if (name === 'get_balances' || name === 'get_month_summary') {
      assertIntegerMinors(data)
    }
    return { ok: true, data }
  } catch (error) {
    return { ok: false, kind: mcpToolErrorResult(error).structuredContent.kind }
  }
}

const TOOL_SCHEMAS: Record<McpReadToolName, z.ZodType> = {
  list_accounts: listAccountsSchema,
  get_balances: getBalancesSchema,
  list_transactions: ledgerPageInputSchema,
  list_categories: listCategoriesSchema,
  list_payees: listPayeesSchema,
  list_recurring: listSeriesSchema,
  list_budgets: listBudgetsMcpSchema,
  get_month_summary: getMonthSummarySchema,
}

/**
 * Register the grant's read tools on a per-request `McpServer`.
 *
 * Tools the grant cannot call are omitted from `tools/list`.
 */
export function registerMcpTools(server: McpServer, ctx: McpToolContext): void {
  for (const name of listedReadToolNames(ctx.scopes)) {
    const inputSchema = TOOL_SCHEMAS[name]
    server.registerTool(
      name,
      {
        description: name.replaceAll('_', ' '),
        inputSchema,
      },
      async (input) => {
        const result = await invokeMcpTool(ctx, name, input)
        if (!result.ok) {
          const failure = { kind: result.kind }
          return {
            isError: true as const,
            content: [{ type: 'text' as const, text: JSON.stringify(failure) }],
            structuredContent: failure,
          }
        }
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result.data) },
          ],
          structuredContent: result.data,
        }
      },
    )
  }
}
