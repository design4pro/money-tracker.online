/**
 * MCP tool names and the grant scope each one needs.
 *
 * Phase 3 registers only the read tools the grant actually holds. Write and
 * delete names exist so a read-only grant's `tools/list` cannot surface them
 * before Phase 4 wires the handlers.
 */

import type { AgentScope } from '#/server/repos/agent-grants'

export const MCP_READ_TOOLS = [
  { name: 'list_accounts', scope: 'accounts:read' },
  { name: 'get_balances', scope: 'accounts:read' },
  { name: 'list_transactions', scope: 'transactions:read' },
  { name: 'list_categories', scope: 'categories:read' },
  { name: 'list_payees', scope: 'payees:read' },
  { name: 'list_recurring', scope: 'recurring:read' },
  { name: 'list_budgets', scope: 'budgets:read' },
  { name: 'get_month_summary', scope: 'budgets:read' },
] as const satisfies ReadonlyArray<{
  readonly name: string
  readonly scope: AgentScope
}>

export type McpReadToolName = (typeof MCP_READ_TOOLS)[number]['name']

export const MCP_WRITE_TOOL_NAMES = [
  'create_transaction',
  'update_transaction',
  'create_category',
  'update_category',
  'create_payee',
  'update_payee',
  'create_recurring',
  'update_recurring',
  'update_budget',
] as const

export const MCP_DELETE_TOOL_NAMES = [
  'delete_transaction',
  'delete_category',
  'delete_payee',
  'delete_recurring',
  'confirm_delete',
] as const

export function listedReadToolNames(
  scopes: ReadonlyArray<AgentScope>,
): ReadonlyArray<McpReadToolName> {
  const held = new Set(scopes)
  return MCP_READ_TOOLS.filter((tool) => held.has(tool.scope)).map(
    (tool) => tool.name,
  )
}

export function scopeForReadTool(name: string): AgentScope | null {
  return MCP_READ_TOOLS.find((tool) => tool.name === name)?.scope ?? null
}

export function isWriteOrDeleteToolName(name: string): boolean {
  return (
    (MCP_WRITE_TOOL_NAMES as ReadonlyArray<string>).includes(name) ||
    (MCP_DELETE_TOOL_NAMES as ReadonlyArray<string>).includes(name)
  )
}
