/**
 * MCP tools. Reads call existing repositories. Writes go through the same
 * Zod schemas and `runWithLedgerBatch`. Deletes return a preview; only
 * `confirm_delete` mutates.
 */

import { CalendarDate } from '@internationalized/date'
import { z } from 'zod'

import { summariseBudgets } from '#/server/budgets/summary'
import { runWithLedgerBatch } from '#/server/ledger/batch'
import { insertAgentAudit } from '#/server/repos/agent-audit'
import {
  getAccount,
  listAccounts,
  listAccountsSchema,
} from '#/server/repos/accounts'
import { scopesOfGrant } from '#/server/repos/agent-grants'
import {
  listBudgetsSchema,
  updateBudget,
  updateBudgetSchema,
} from '#/server/repos/budgets'
import {
  createCategory,
  createCategorySchema,
  deleteCategory,
  getCategory,
  listCategories,
  listCategoriesSchema,
  updateCategory,
  updateCategorySchema,
} from '#/server/repos/categories'
import {
  createPayee,
  createPayeeSchema,
  deletePayee,
  getPayee,
  listPayees,
  listPayeesSchema,
  updatePayee,
  updatePayeeSchema,
} from '#/server/repos/payees'
import {
  createSeries,
  createSeriesSchema,
  deleteSeries,
  getSeries,
  listSeries,
  listSeriesSchema,
  updateSeries,
  updateSeriesSchema,
} from '#/server/repos/recurring'
import {
  ledgerPageInputSchema,
  sumTransactions,
} from '#/server/repos/transaction-queries'
import {
  createTransaction,
  createTransactionSchema,
  deleteTransaction,
  getTransaction,
  transactionPoliciesSchema,
  updateTransaction,
  updateTransactionSchema,
} from '#/server/repos/transactions'
import { NotFoundError } from '#/server/repos/errors'
import { conversionContextFor } from '#/server/repos/workspace-currencies'
import { ledgerPageFor } from '#/server/transactions/ledger-page'

import { listedMcpToolNames, specForTool } from './catalog'
import { assertIntegerMinors, toJsonValue } from './json'
import {
  MCP_CONFIRM_TTL_SEC,
  assertMcpRateLimit,
  putConfirmTicket,
  takeConfirmTicket,
} from './kv'
import { McpDeniedError, mcpToolErrorResult } from './tool-error'

import type { McpToolErrorKind } from './tool-error'
import type { McpToolName } from './catalog'
import type { JsonValue } from './json'
import type { McpKv } from './kv'
import type { AgentAuditOutcome, AgentResource, AgentVerb } from '#/lib/enums'
import type { McpServer } from '@modelcontextprotocol/server'
import type { AgentGrantRow } from '#/server/db/schema'
import type { AgentScope } from '#/server/repos/agent-grants'
import type { TenantScope } from '#/server/repos/base'

const idField = z.string().trim().min(1).max(64)

export interface McpToolContext {
  readonly scopes: ReadonlyArray<AgentScope>
  readonly scope: TenantScope
  readonly grantId?: string
  readonly userId?: string
  readonly kv?: McpKv
  readonly now?: () => number
}

export function toolContextForGrant(
  grant: AgentGrantRow,
  scope: TenantScope,
  kv: McpKv,
): McpToolContext {
  return {
    scopes: scopesOfGrant(grant),
    scope,
    grantId: grant.id,
    userId: grant.userId,
    kv,
    now: () => Date.now(),
  }
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

const createTransactionMcpSchema = createTransactionSchema.extend({
  policies: transactionPoliciesSchema,
})

const updateTransactionMcpSchema = updateTransactionSchema.extend({
  id: idField,
  policies: transactionPoliciesSchema,
})

const deleteTransactionMcpSchema = z.strictObject({
  id: idField,
  policies: transactionPoliciesSchema,
})

const idInputSchema = z.strictObject({ id: idField })

const updateCategoryMcpSchema = updateCategorySchema.extend({ id: idField })
const updatePayeeMcpSchema = updatePayeeSchema.extend({ id: idField })
const updateRecurringMcpSchema = updateSeriesSchema.extend({ id: idField })
const updateBudgetMcpSchema = updateBudgetSchema.extend({ id: idField })
const confirmDeleteSchema = z.strictObject({ confirmToken: idField })

function monthBounds(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const start = new CalendarDate(year, monthNumber, 1)
  const end = start.add({ months: 1 }).subtract({ days: 1 })
  return { from: start.toString(), to: end.toString() }
}

function nowMs(ctx: McpToolContext): number {
  return ctx.now?.() ?? Date.now()
}

function requireHeldScope(ctx: McpToolContext, needed: AgentScope): void {
  if (!ctx.scopes.includes(needed)) throw new McpDeniedError()
}

function requireToolAccess(ctx: McpToolContext, name: string): void {
  const spec = specForTool(name)
  if (spec === null) throw new McpDeniedError()
  if (spec.scope === null) {
    if (!ctx.scopes.some((scope) => scope.endsWith(':delete'))) {
      throw new McpDeniedError()
    }
    return
  }
  requireHeldScope(ctx, spec.scope)
  if (spec.verb === 'delete' && spec.resource !== null) {
    requireHeldScope(ctx, `${spec.resource}:read`)
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

async function runCreateTransaction(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = createTransactionMcpSchema.parse(input)
  const { policies, ...body } = parsed
  return runWithLedgerBatch(async () =>
    createTransaction({
      scope: ctx.scope,
      policies,
      conversion: await conversionContextFor(ctx.scope),
      input: body,
    }),
  )
}

async function runUpdateTransaction(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = updateTransactionMcpSchema.parse(input)
  const { id, policies, ...patch } = parsed
  return runWithLedgerBatch(async () =>
    updateTransaction({
      scope: ctx.scope,
      policies,
      conversion: await conversionContextFor(ctx.scope),
      id,
      patch,
    }),
  )
}

async function runCreateCategory(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = createCategorySchema.parse(input ?? {})
  return runWithLedgerBatch(() => createCategory(ctx.scope, parsed))
}

async function runUpdateCategory(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = updateCategoryMcpSchema.parse(input)
  const { id, ...patch } = parsed
  return runWithLedgerBatch(() => updateCategory(ctx.scope, id, patch))
}

async function runCreatePayee(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = createPayeeSchema.parse(input ?? {})
  return runWithLedgerBatch(() => createPayee(ctx.scope, parsed))
}

async function runUpdatePayee(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = updatePayeeMcpSchema.parse(input)
  const { id, ...patch } = parsed
  return runWithLedgerBatch(() => updatePayee(ctx.scope, id, patch))
}

async function runCreateRecurring(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = createSeriesSchema.parse(input)
  return runWithLedgerBatch(() => createSeries(ctx.scope, parsed))
}

async function runUpdateRecurring(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = updateRecurringMcpSchema.parse(input)
  const { id, ...patch } = parsed
  return runWithLedgerBatch(() => updateSeries(ctx.scope, id, patch))
}

async function runUpdateBudget(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = updateBudgetMcpSchema.parse(input)
  const { id, ...patch } = parsed
  return runWithLedgerBatch(() => updateBudget(ctx.scope, id, patch))
}

function previewPayload(
  resource: AgentResource,
  id: string,
  labelKey: string,
  confirmToken: string,
): {
  resource: AgentResource
  id: string
  labelKey: string
  confirmToken: string
  expiresInSec: number
} {
  return {
    resource,
    id,
    labelKey,
    confirmToken,
    expiresInSec: MCP_CONFIRM_TTL_SEC,
  }
}

async function issuePreview(
  ctx: McpToolContext,
  resource: AgentResource,
  id: string,
  labelKey: string,
): Promise<unknown> {
  if (ctx.kv === undefined || ctx.grantId === undefined) {
    throw new McpDeniedError()
  }
  const confirmToken = await putConfirmTicket(ctx.kv, ctx.grantId, {
    resource,
    id,
    labelKey,
  })
  return previewPayload(resource, id, labelKey, confirmToken)
}

async function runDeleteTransaction(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = deleteTransactionMcpSchema.parse(input)
  await getTransaction({
    scope: ctx.scope,
    policies: parsed.policies,
    id: parsed.id,
  })
  return issuePreview(
    ctx,
    'transactions',
    parsed.id,
    'mcp.preview.delete.transaction',
  )
}

async function runDeleteCategory(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = idInputSchema.parse(input)
  await getCategory(ctx.scope, parsed.id)
  return issuePreview(
    ctx,
    'categories',
    parsed.id,
    'mcp.preview.delete.category',
  )
}

async function runDeletePayee(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = idInputSchema.parse(input)
  await getPayee(ctx.scope, parsed.id)
  return issuePreview(ctx, 'payees', parsed.id, 'mcp.preview.delete.payee')
}

async function runDeleteRecurring(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = idInputSchema.parse(input)
  await getSeries(ctx.scope, parsed.id)
  return issuePreview(
    ctx,
    'recurring',
    parsed.id,
    'mcp.preview.delete.recurring',
  )
}

async function executeConfirmedDelete(
  ctx: McpToolContext,
  resource: AgentResource,
  id: string,
): Promise<unknown> {
  requireHeldScope(ctx, `${resource}:delete`)
  switch (resource) {
    case 'transactions':
      return runWithLedgerBatch(() =>
        deleteTransaction({
          scope: ctx.scope,
          policies: {
            planned: 'include',
            adjustments: 'include',
            transfers: 'include',
            completeness: 'any',
          },
          id,
        }),
      )
    case 'categories':
      return runWithLedgerBatch(() => deleteCategory(ctx.scope, id))
    case 'payees':
      return runWithLedgerBatch(() => deletePayee(ctx.scope, id))
    case 'recurring':
      return runWithLedgerBatch(() => deleteSeries(ctx.scope, id))
    default:
      throw new McpDeniedError()
  }
}

async function runConfirmDelete(
  ctx: McpToolContext,
  input: unknown,
): Promise<unknown> {
  const parsed = confirmDeleteSchema.parse(input)
  if (ctx.kv === undefined || ctx.grantId === undefined) {
    throw new McpDeniedError()
  }
  const ticket = await takeConfirmTicket(
    ctx.kv,
    ctx.grantId,
    parsed.confirmToken,
  )
  if (ticket === null) {
    throw new NotFoundError('confirm ticket', parsed.confirmToken)
  }
  await executeConfirmedDelete(ctx, ticket.resource, ticket.id)
  return { deleted: true, resource: ticket.resource, id: ticket.id }
}

const RUNNERS: Record<
  McpToolName,
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
  create_transaction: runCreateTransaction,
  update_transaction: runUpdateTransaction,
  create_category: runCreateCategory,
  update_category: runUpdateCategory,
  create_payee: runCreatePayee,
  update_payee: runUpdatePayee,
  create_recurring: runCreateRecurring,
  update_recurring: runUpdateRecurring,
  update_budget: runUpdateBudget,
  delete_transaction: runDeleteTransaction,
  delete_category: runDeleteCategory,
  delete_payee: runDeletePayee,
  delete_recurring: runDeleteRecurring,
  confirm_delete: runConfirmDelete,
}

function resourceIdOf(input: unknown, data: unknown): string | null {
  if (
    typeof data === 'object' &&
    data !== null &&
    'id' in data &&
    typeof data.id === 'string'
  ) {
    return data.id
  }
  if (
    typeof input === 'object' &&
    input !== null &&
    'id' in input &&
    typeof input.id === 'string'
  ) {
    return input.id
  }
  return null
}

function outcomeOf(kind: McpToolErrorKind | 'ok'): AgentAuditOutcome {
  switch (kind) {
    case 'ok':
      return 'ok'
    case 'denied':
    case 'feature_locked':
      return 'denied'
    case 'not_found':
      return 'not_found'
    case 'invalid':
      return 'invalid'
    case 'rate_limited':
      return 'rate_limited'
    default:
      return 'error'
  }
}

async function writeAudit(
  ctx: McpToolContext,
  args: {
    readonly tool: string
    readonly verb: AgentVerb
    readonly resource: AgentResource
    readonly resourceId: string | null
    readonly outcome: AgentAuditOutcome
  },
): Promise<void> {
  if (ctx.grantId === undefined || ctx.userId === undefined) return
  try {
    await insertAgentAudit(
      ctx.scope,
      {
        grantId: ctx.grantId,
        userId: ctx.userId,
        tool: args.tool,
        verb: args.verb,
        resource: args.resource,
        resourceId: args.resourceId,
        outcome: args.outcome,
      },
      new Date(nowMs(ctx)),
    )
  } catch {
    // A failed audit row must not fail a write that already committed.
  }
}

export type McpToolSuccess = {
  readonly ok: true
  readonly data: JsonValue
}

export type McpToolFailureResult = {
  readonly ok: false
  readonly kind: McpToolErrorKind
  readonly retryAfterSec?: number
}

export async function invokeMcpTool(
  ctx: McpToolContext,
  name: string,
  input: unknown,
): Promise<McpToolSuccess | McpToolFailureResult> {
  const spec = specForTool(name)
  let resourceId = resourceIdOf(input, null)
  try {
    if (spec === null) throw new McpDeniedError()
    if (
      ctx.kv !== undefined &&
      ctx.grantId !== undefined &&
      ctx.userId !== undefined
    ) {
      await assertMcpRateLimit({
        kv: ctx.kv,
        grantId: ctx.grantId,
        userId: ctx.userId,
        verb: spec.verb,
        nowMs: nowMs(ctx),
      })
    }
    requireToolAccess(ctx, name)
    const runner = RUNNERS[spec.name]
    const data = toJsonValue(await runner(ctx, input))
    resourceId = resourceIdOf(input, data)
    if (
      name === 'get_balances' ||
      name === 'get_month_summary' ||
      spec.verb === 'write'
    ) {
      assertIntegerMinors(data)
    }
    await writeAudit(ctx, {
      tool: name,
      verb: spec.verb,
      resource: spec.resource ?? resourceResourceFromData(data),
      resourceId,
      outcome: 'ok',
    })
    return { ok: true, data }
  } catch (error) {
    const failure = mcpToolErrorResult(error).structuredContent
    if (spec !== null) {
      await writeAudit(ctx, {
        tool: name,
        verb: spec.verb,
        resource: spec.resource ?? 'transactions',
        resourceId,
        outcome: outcomeOf(failure.kind),
      })
    }
    return failure.retryAfterSec === undefined
      ? { ok: false, kind: failure.kind }
      : {
          ok: false,
          kind: failure.kind,
          retryAfterSec: failure.retryAfterSec,
        }
  }
}

function resourceResourceFromData(data: JsonValue): AgentResource {
  if (
    typeof data === 'object' &&
    data !== null &&
    'resource' in data &&
    typeof data.resource === 'string'
  ) {
    return data.resource as AgentResource
  }
  return 'transactions'
}

const TOOL_SCHEMAS: Record<McpToolName, z.ZodType> = {
  list_accounts: listAccountsSchema,
  get_balances: getBalancesSchema,
  list_transactions: ledgerPageInputSchema,
  list_categories: listCategoriesSchema,
  list_payees: listPayeesSchema,
  list_recurring: listSeriesSchema,
  list_budgets: listBudgetsMcpSchema,
  get_month_summary: getMonthSummarySchema,
  create_transaction: createTransactionMcpSchema,
  update_transaction: updateTransactionMcpSchema,
  create_category: createCategorySchema,
  update_category: updateCategoryMcpSchema,
  create_payee: createPayeeSchema,
  update_payee: updatePayeeMcpSchema,
  create_recurring: createSeriesSchema,
  update_recurring: updateRecurringMcpSchema,
  update_budget: updateBudgetMcpSchema,
  delete_transaction: deleteTransactionMcpSchema,
  delete_category: idInputSchema,
  delete_payee: idInputSchema,
  delete_recurring: idInputSchema,
  confirm_delete: confirmDeleteSchema,
}

/**
 * Register the grant's tools on a per-request `McpServer`.
 *
 * Tools the grant cannot call are omitted from `tools/list`.
 */
export function registerMcpTools(server: McpServer, ctx: McpToolContext): void {
  for (const name of listedMcpToolNames(ctx.scopes)) {
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
          const failure =
            result.retryAfterSec === undefined
              ? { kind: result.kind }
              : { kind: result.kind, retryAfterSec: result.retryAfterSec }
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
