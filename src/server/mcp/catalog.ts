/**
 * MCP tool names and the grant scope each one needs.
 *
 * `listTools` is the intersection of the catalogue and the grant's scopes.
 * `confirm_delete` is listed when the grant holds any `:delete` scope; the
 * ticket's resource is checked again at invoke time.
 */

import type { AgentResource, AgentVerb } from '#/lib/enums'
import type { AgentScope } from '#/server/repos/agent-grants'

export const MCP_READ_TOOLS = [
  { name: 'list_accounts', scope: 'accounts:read', resource: 'accounts' },
  { name: 'get_balances', scope: 'accounts:read', resource: 'accounts' },
  {
    name: 'list_transactions',
    scope: 'transactions:read',
    resource: 'transactions',
  },
  { name: 'list_categories', scope: 'categories:read', resource: 'categories' },
  { name: 'list_payees', scope: 'payees:read', resource: 'payees' },
  { name: 'list_recurring', scope: 'recurring:read', resource: 'recurring' },
  { name: 'list_budgets', scope: 'budgets:read', resource: 'budgets' },
  { name: 'get_month_summary', scope: 'budgets:read', resource: 'budgets' },
] as const satisfies ReadonlyArray<{
  readonly name: string
  readonly scope: AgentScope
  readonly resource: AgentResource
}>

export type McpReadToolName = (typeof MCP_READ_TOOLS)[number]['name']

export const MCP_WRITE_TOOLS = [
  {
    name: 'create_transaction',
    scope: 'transactions:write',
    resource: 'transactions',
  },
  {
    name: 'update_transaction',
    scope: 'transactions:write',
    resource: 'transactions',
  },
  {
    name: 'create_category',
    scope: 'categories:write',
    resource: 'categories',
  },
  {
    name: 'update_category',
    scope: 'categories:write',
    resource: 'categories',
  },
  { name: 'create_payee', scope: 'payees:write', resource: 'payees' },
  { name: 'update_payee', scope: 'payees:write', resource: 'payees' },
  {
    name: 'create_recurring',
    scope: 'recurring:write',
    resource: 'recurring',
  },
  {
    name: 'update_recurring',
    scope: 'recurring:write',
    resource: 'recurring',
  },
  { name: 'update_budget', scope: 'budgets:write', resource: 'budgets' },
] as const satisfies ReadonlyArray<{
  readonly name: string
  readonly scope: AgentScope
  readonly resource: AgentResource
}>

export type McpWriteToolName = (typeof MCP_WRITE_TOOLS)[number]['name']

export const MCP_DELETE_TOOLS = [
  {
    name: 'delete_transaction',
    scope: 'transactions:delete',
    resource: 'transactions',
  },
  {
    name: 'delete_category',
    scope: 'categories:delete',
    resource: 'categories',
  },
  { name: 'delete_payee', scope: 'payees:delete', resource: 'payees' },
  {
    name: 'delete_recurring',
    scope: 'recurring:delete',
    resource: 'recurring',
  },
] as const satisfies ReadonlyArray<{
  readonly name: string
  readonly scope: AgentScope
  readonly resource: AgentResource
}>

export type McpDeleteToolName = (typeof MCP_DELETE_TOOLS)[number]['name']

export type McpConfirmToolName = 'confirm_delete'

export type McpToolName =
  McpReadToolName | McpWriteToolName | McpDeleteToolName | McpConfirmToolName

export interface McpToolSpec {
  readonly name: McpToolName
  readonly verb: AgentVerb
  readonly resource: AgentResource | null
  readonly scope: AgentScope | null
}

const SPECS: ReadonlyArray<McpToolSpec> = [
  ...MCP_READ_TOOLS.map((tool) => ({
    name: tool.name,
    verb: 'read' as const,
    resource: tool.resource,
    scope: tool.scope,
  })),
  ...MCP_WRITE_TOOLS.map((tool) => ({
    name: tool.name,
    verb: 'write' as const,
    resource: tool.resource,
    scope: tool.scope,
  })),
  ...MCP_DELETE_TOOLS.map((tool) => ({
    name: tool.name,
    verb: 'delete' as const,
    resource: tool.resource,
    scope: tool.scope,
  })),
  {
    name: 'confirm_delete',
    verb: 'delete',
    resource: null,
    scope: null,
  },
]

export function specForTool(name: string): McpToolSpec | null {
  return SPECS.find((tool) => tool.name === name) ?? null
}

export function listedReadToolNames(
  scopes: ReadonlyArray<AgentScope>,
): ReadonlyArray<McpReadToolName> {
  const held = new Set(scopes)
  return MCP_READ_TOOLS.filter((tool) => held.has(tool.scope)).map(
    (tool) => tool.name,
  )
}

export function listedMcpToolNames(
  scopes: ReadonlyArray<AgentScope>,
): ReadonlyArray<McpToolName> {
  const held = new Set(scopes)
  const names: Array<McpToolName> = [
    ...MCP_READ_TOOLS.filter((tool) => held.has(tool.scope)).map(
      (tool) => tool.name,
    ),
    ...MCP_WRITE_TOOLS.filter((tool) => held.has(tool.scope)).map(
      (tool) => tool.name,
    ),
    ...MCP_DELETE_TOOLS.filter((tool) => held.has(tool.scope)).map(
      (tool) => tool.name,
    ),
  ]
  if (scopes.some((scope) => scope.endsWith(':delete'))) {
    names.push('confirm_delete')
  }
  return names
}
