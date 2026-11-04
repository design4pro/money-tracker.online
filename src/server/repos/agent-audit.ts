/**
 * MCP (and mint) audit rows: ids, tool, verb, outcome — never amounts or
 * payloads. Tenant-scoped through {@link createTenantRepository}.
 */

import { z } from 'zod'

import { AGENT_AUDIT_OUTCOMES, AGENT_RESOURCES, AGENT_VERBS } from '#/lib/enums'
import { newId } from '#/server/db/ids'
import { agentAuditLog } from '#/server/db/schema'

import { createTenantRepository, desc } from './base'

import type { AgentAuditLogRow } from '#/server/db/schema'
import type { TenantScope } from './base'

const auditAccess = createTenantRepository(agentAuditLog, 'agent audit')

export const insertAgentAuditSchema = z.strictObject({
  grantId: z.string().trim().min(1).max(64),
  userId: z.string().trim().min(1).max(64),
  tool: z.string().trim().min(1).max(80),
  verb: z.enum(AGENT_VERBS),
  resource: z.enum(AGENT_RESOURCES),
  resourceId: z.string().trim().min(1).max(64).nullable(),
  outcome: z.enum(AGENT_AUDIT_OUTCOMES),
})

export type InsertAgentAuditInput = z.input<typeof insertAgentAuditSchema>

export async function insertAgentAudit(
  scope: TenantScope,
  input: InsertAgentAuditInput,
  now: Date,
): Promise<AgentAuditLogRow> {
  const parsed = insertAgentAuditSchema.parse(input)
  return auditAccess.insert(scope, {
    id: newId(),
    grantId: parsed.grantId,
    userId: parsed.userId,
    tool: parsed.tool,
    verb: parsed.verb,
    resource: parsed.resource,
    resourceId: parsed.resourceId,
    outcome: parsed.outcome,
    createdAt: now,
  })
}

/** Newest first. Ids and outcomes only — the table has no payload columns. */
export async function listAgentAudit(
  scope: TenantScope,
): Promise<ReadonlyArray<AgentAuditLogRow>> {
  return auditAccess.findMany(scope, {
    orderBy: [desc(agentAuditLog.createdAt), desc(agentAuditLog.id)],
  })
}
