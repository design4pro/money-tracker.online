/**
 * MCP read and write tools: grant-scoped list, integer minors, tenant
 * isolation, two-step delete, rate limits, audit without amounts.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { payees, recurringSeries } from '#/server/db/schema'
import { listAgentAudit } from '#/server/repos/agent-audit'
import { createPatGrant } from '#/server/repos/agent-grants'
import {
  createBudgetWorld,
  NOW,
  seedBudget,
  seedCategory,
  seedTransaction,
} from '#/server/repos/__tests__/budget-harness'

import { listedMcpToolNames, listedReadToolNames } from '../catalog'
import { jsonHasDecimalNumber } from '../json'
import { MemoryMcpKv } from '../kv'
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

const ALL_WRITE: ReadonlyArray<AgentScope> = [
  ...ALL_READ,
  'transactions:write',
  'transactions:delete',
  'categories:write',
  'categories:delete',
  'payees:write',
  'payees:delete',
  'recurring:write',
  'recurring:delete',
  'budgets:write',
]

async function mintedCtx(
  side: 'a' | 'b',
  scopes: ReadonlyArray<AgentScope> = ALL_WRITE,
  options: { kv?: MemoryMcpKv; now?: () => number } = {},
): Promise<McpToolContext> {
  const scope = side === 'a' ? world.scope : world.otherScope
  const minted = await createPatGrant(
    scope,
    { name: `${side} agent`, scopes: [...scopes], environment: 'stg' },
    NOW,
  )
  const now = options.now ?? (() => NOW.getTime())
  return {
    scopes,
    scope,
    grantId: minted.grant.id,
    userId: scope.ctx.userId,
    kv: options.kv ?? new MemoryMcpKv(now),
    now,
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

  it('lists write and confirm_delete only when those scopes are held', () => {
    const readOnly = listedMcpToolNames(['accounts:read'])
    expect(readOnly).toEqual(['list_accounts', 'get_balances'])
    const writes = listedMcpToolNames(['transactions:write'])
    expect(writes).toEqual(['create_transaction', 'update_transaction'])
    expect(writes).not.toContain('delete_transaction')
    const deletes = listedMcpToolNames(['transactions:delete'])
    expect(deletes).toEqual(['delete_transaction', 'confirm_delete'])
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

describe('write tools stay inside the grantor’s workspace', () => {
  it('create_transaction with B’s account is not_found', async () => {
    const result = await invokeMcpTool(
      ctxFor('a', ALL_WRITE),
      'create_transaction',
      {
        accountId: 'acc-b',
        direction: 'expense',
        amountMinor: 10_00,
        bookedOn: '2026-03-10',
        policies: POLICIES,
      },
    )
    expect(result).toEqual({ ok: false, kind: 'not_found' })
  })

  it('update_transaction with B’s id is not_found', async () => {
    const result = await invokeMcpTool(
      ctxFor('a', ALL_WRITE),
      'update_transaction',
      {
        id: 'tx-b',
        note: 'nope',
        policies: POLICIES,
      },
    )
    expect(result).toEqual({ ok: false, kind: 'not_found' })
  })

  it('update_category with B’s id is not_found', async () => {
    const result = await invokeMcpTool(
      ctxFor('a', ALL_WRITE),
      'update_category',
      {
        id: 'cat-b',
        name: 'Stolen',
      },
    )
    expect(result).toEqual({ ok: false, kind: 'not_found' })
  })

  it('update_payee with B’s id is not_found', async () => {
    const result = await invokeMcpTool(ctxFor('a', ALL_WRITE), 'update_payee', {
      id: 'payee-b',
      name: 'Stolen',
    })
    expect(result).toEqual({ ok: false, kind: 'not_found' })
  })

  it('update_recurring with B’s id is not_found', async () => {
    const result = await invokeMcpTool(
      ctxFor('a', ALL_WRITE),
      'update_recurring',
      {
        id: 'series-b',
        name: 'Stolen',
      },
    )
    expect(result).toEqual({ ok: false, kind: 'not_found' })
  })

  it('update_budget with B’s id is not_found', async () => {
    const result = await invokeMcpTool(
      ctxFor('a', ALL_WRITE),
      'update_budget',
      {
        id: 'budget-b',
        name: 'Stolen',
      },
    )
    expect(result).toEqual({ ok: false, kind: 'not_found' })
  })

  it('a write grant cannot call delete_transaction', async () => {
    const result = await invokeMcpTool(
      ctxFor('a', ['transactions:write', 'transactions:read']),
      'delete_transaction',
      { id: 'tx-a', policies: POLICIES },
    )
    expect(result).toEqual({ ok: false, kind: 'denied' })
  })
})

describe('two-step delete', () => {
  it('previews, confirms once, and a second confirm is not_found', async () => {
    const ctx = await mintedCtx('a')
    const preview = await invokeMcpTool(ctx, 'delete_transaction', {
      id: 'tx-a',
      policies: POLICIES,
    })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const data = preview.data as {
      resource: string
      id: string
      labelKey: string
      confirmToken: string
      expiresInSec: number
    }
    expect(data).toMatchObject({
      resource: 'transactions',
      id: 'tx-a',
      labelKey: 'mcp.preview.delete.transaction',
      expiresInSec: 60,
    })
    expect(data.confirmToken.length).toBeGreaterThan(8)
    expect(JSON.stringify(data)).not.toMatch(/1234/)

    const first = await invokeMcpTool(ctx, 'confirm_delete', {
      confirmToken: data.confirmToken,
    })
    expect(first.ok).toBe(true)

    const second = await invokeMcpTool(ctx, 'confirm_delete', {
      confirmToken: data.confirmToken,
    })
    expect(second).toEqual({ ok: false, kind: 'not_found' })
  })

  it('delete_transaction with B’s id is not_found', async () => {
    const ctx = await mintedCtx('a')
    const result = await invokeMcpTool(ctx, 'delete_transaction', {
      id: 'tx-b',
      policies: POLICIES,
    })
    expect(result).toEqual({ ok: false, kind: 'not_found' })
  })

  it('A cannot confirm B’s ticket', async () => {
    const ctxB = await mintedCtx('b')
    const preview = await invokeMcpTool(ctxB, 'delete_payee', { id: 'payee-b' })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const token = (preview.data as { confirmToken: string }).confirmToken
    const ctxA = await mintedCtx('a')
    const stolen = await invokeMcpTool(ctxA, 'confirm_delete', {
      confirmToken: token,
    })
    expect(stolen).toEqual({ ok: false, kind: 'not_found' })
  })
})

describe('audit rows carry ids, never amounts', () => {
  it('does not store the written minor units', async () => {
    const amountMinor = 77_777
    const ctx = await mintedCtx('a')
    const created = await invokeMcpTool(ctx, 'create_transaction', {
      accountId: 'acc-a',
      direction: 'expense',
      amountMinor,
      bookedOn: '2026-03-10',
      policies: POLICIES,
    })
    expect(created.ok).toBe(true)
    const rows = await listAgentAudit(world.scope)
    expect(rows.length).toBeGreaterThan(0)
    const payload = JSON.stringify(rows)
    expect(payload).not.toContain(String(amountMinor))
    expect(payload).not.toMatch(/amount/i)
    expect(rows[0]?.outcome).toBe('ok')
    expect(rows[0]?.tool).toBe('create_transaction')
    expect(rows[0]?.resourceId).toEqual(expect.any(String))
  })
})

describe('rate limits use a fake KV clock', () => {
  it('refuses the sixth delete in a minute and resets after the window', async () => {
    let now = NOW.getTime()
    const kv = new MemoryMcpKv(() => now)
    const ctx = await mintedCtx('a', ALL_WRITE, { kv, now: () => now })
    for (let i = 0; i < 5; i += 1) {
      const result = await invokeMcpTool(ctx, 'delete_category', {
        id: 'cat-a',
      })
      expect(result.ok).toBe(true)
    }
    const limited = await invokeMcpTool(ctx, 'delete_category', { id: 'cat-a' })
    expect(limited.ok).toBe(false)
    if (limited.ok) return
    expect(limited.kind).toBe('rate_limited')
    expect(limited.retryAfterSec).toBeGreaterThan(0)

    now += 60_000
    const after = await invokeMcpTool(ctx, 'delete_category', { id: 'cat-a' })
    expect(after.ok).toBe(true)
  })
})
