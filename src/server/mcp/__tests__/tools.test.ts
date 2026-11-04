/**
 * Phase 3 MCP read tools: grant-scoped list, integer minors, tenant isolation
 * on synthetic workspaces A and B.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { payees, recurringSeries } from '#/server/db/schema'
import {
  createBudgetWorld,
  NOW,
  seedBudget,
  seedCategory,
  seedTransaction,
} from '#/server/repos/__tests__/budget-harness'

import { listedReadToolNames } from '../catalog'
import { jsonHasDecimalNumber } from '../json'
import { invokeMcpTool } from '../tools'

import type { McpToolContext } from '../tools'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type { AgentScope } from '#/server/repos/agent-grants'

const POLICIES = {
  planned: 'exclude',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
} as const

const LEDGER_INPUT = {
  policies: POLICIES,
  filters: {},
  sort: { field: 'bookedOn', direction: 'desc' } as const,
  cursor: null,
}

const ALL_READ: ReadonlyArray<AgentScope> = [
  'accounts:read',
  'transactions:read',
  'categories:read',
  'payees:read',
  'recurring:read',
  'budgets:read',
]

let world: BudgetWorld

function ctxFor(
  side: 'a' | 'b',
  scopes: ReadonlyArray<AgentScope> = ALL_READ,
): McpToolContext {
  return {
    scopes,
    scope: side === 'a' ? world.scope : world.otherScope,
  }
}

beforeEach(async () => {
  world = await createBudgetWorld()
  await seedCategory(world.db, { id: 'cat-a', name: 'Groceries' })
  await seedCategory(world.db, {
    id: 'cat-b',
    name: 'B groceries',
    organizationId: 'org-b',
  })
  await world.db.insert(payees).values([
    {
      id: 'payee-a',
      organizationId: 'org-a',
      name: 'Shop A',
      categorizationMode: 'hint',
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'payee-b',
      organizationId: 'org-b',
      name: 'Shop B',
      categorizationMode: 'hint',
      createdAt: NOW,
      updatedAt: NOW,
    },
  ])
  await world.db.insert(recurringSeries).values([
    {
      id: 'series-a',
      organizationId: 'org-a',
      name: 'Rent A',
      kind: 'bill',
      direction: 'expense',
      expectedAmountMinor: 100_00,
      expectedCurrencyCode: 'PLN',
      frequency: 'monthly',
      startDate: '2026-01-01',
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'series-b',
      organizationId: 'org-b',
      name: 'Rent B',
      kind: 'bill',
      direction: 'expense',
      expectedAmountMinor: 200_00,
      expectedCurrencyCode: 'PLN',
      frequency: 'monthly',
      startDate: '2026-01-01',
      createdAt: NOW,
      updatedAt: NOW,
    },
  ])
  await seedBudget(world.db, { id: 'budget-a', name: 'Food A' })
  await seedBudget(world.db, {
    id: 'budget-b',
    name: 'Food B',
    organizationId: 'org-b',
  })
  await seedTransaction(world.db, {
    id: 'tx-a',
    refAmountMinor: 12_34,
    bookedOn: '2026-03-10',
  })
  await seedTransaction(world.db, {
    id: 'tx-b',
    refAmountMinor: 77_00,
    bookedOn: '2026-03-10',
    organizationId: 'org-b',
    accountId: 'acc-b',
    categoryId: 'cat-b',
  })
})

describe('listTools follows grant scopes', () => {
  it('omits write names and tools the grant cannot call', () => {
    const listed = listedReadToolNames(['accounts:read'])
    expect(listed).toEqual(['list_accounts', 'get_balances'])
    expect(listed).not.toContain('list_transactions')
    expect(listed).not.toContain('create_transaction')
    expect(listed).not.toContain('confirm_delete')
  })
})

describe('a read-only grant cannot call writes', () => {
  it('refuses create_transaction with denied', async () => {
    const result = await invokeMcpTool(
      ctxFor('a', ['accounts:read']),
      'create_transaction',
      {},
    )
    expect(result).toEqual({ ok: false, kind: 'denied' })
  })

  it('refuses list_transactions without transactions:read', async () => {
    const result = await invokeMcpTool(
      ctxFor('a', ['accounts:read']),
      'list_transactions',
      LEDGER_INPUT,
    )
    expect(result).toEqual({ ok: false, kind: 'denied' })
  })
})

describe('read tools stay inside the grantor’s workspace', () => {
  it('list_accounts does not include B’s account', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'list_accounts', {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const payload = JSON.stringify(result.data)
    expect(payload).toContain('acc-a')
    expect(payload).not.toContain('acc-b')
  })

  it('get_balances with B’s account id is not_found', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'get_balances', {
      accountIds: ['acc-b'],
    })
    expect(result).toEqual({ ok: false, kind: 'not_found' })
  })

  it('list_transactions with B’s account id is not_found', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'list_transactions', {
      ...LEDGER_INPUT,
      filters: { accountIds: ['acc-b'] },
    })
    expect(result).toEqual({ ok: false, kind: 'not_found' })
  })

  it('list_transactions with B’s category id is not_found', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'list_transactions', {
      ...LEDGER_INPUT,
      filters: { categoryIds: ['cat-b'] },
    })
    expect(result).toEqual({ ok: false, kind: 'not_found' })
  })

  it('list_transactions with B’s payee id is not_found', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'list_transactions', {
      ...LEDGER_INPUT,
      filters: { payeeIds: ['payee-b'] },
    })
    expect(result).toEqual({ ok: false, kind: 'not_found' })
  })

  it('list_categories does not include B’s category', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'list_categories', {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const payload = JSON.stringify(result.data)
    expect(payload).toContain('cat-a')
    expect(payload).not.toContain('cat-b')
  })

  it('list_payees does not include B’s payee', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'list_payees', {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const payload = JSON.stringify(result.data)
    expect(payload).toContain('payee-a')
    expect(payload).not.toContain('payee-b')
  })

  it('list_recurring does not include B’s series', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'list_recurring', {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const payload = JSON.stringify(result.data)
    expect(payload).toContain('series-a')
    expect(payload).not.toContain('series-b')
  })

  it('list_budgets does not include B’s budget', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'list_budgets', {
      month: '2026-03',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const payload = JSON.stringify(result.data)
    expect(payload).toContain('budget-a')
    expect(payload).not.toContain('budget-b')
  })

  it('get_month_summary totals A’s integer minors only', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'get_month_summary', {
      month: '2026-03',
      policies: POLICIES,
    })
    expect(result).toEqual({
      ok: true,
      data: {
        incomeMinor: 0,
        expenseMinor: 12_34,
        netMinor: -12_34,
        currencyCode: 'PLN',
      },
    })
    if (!result.ok) return
    expect(jsonHasDecimalNumber(JSON.stringify(result.data))).toBe(false)
  })
})

describe('balances are integer minors', () => {
  it('get_balances payload has no decimal number tokens', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'get_balances', {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const payload = JSON.stringify(result.data)
    expect(jsonHasDecimalNumber(payload)).toBe(false)
    expect(payload).toContain('"balanceMinor"')
  })
})

describe('list_transactions requires policies', () => {
  it('rejects a call that omits policies', async () => {
    const result = await invokeMcpTool(ctxFor('a'), 'list_transactions', {
      filters: {},
      sort: { field: 'bookedOn', direction: 'desc' },
      cursor: null,
    })
    expect(result).toEqual({ ok: false, kind: 'invalid' })
  })
})
