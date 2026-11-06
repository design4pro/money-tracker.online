/**
 * Closed `resource:verb` vocabulary for agent grants, usable in the browser.
 *
 * The repository re-parses the same strings. This module exists so a consent
 * page and a mint form do not import `#/server/repos`.
 */

import { AGENT_RESOURCES, AGENT_VERBS } from './enums'

import type { AgentResource, AgentVerb } from './enums'

export type AgentScope = `${AgentResource}:${AgentVerb}`

export const AGENT_SCOPES = AGENT_RESOURCES.flatMap((resource) =>
  AGENT_VERBS.map((verb) => `${resource}:${verb}` as AgentScope),
)

export const READ_SCOPES = AGENT_RESOURCES.map(
  (resource) => `${resource}:read` as AgentScope,
)

const AGENT_SCOPE_SET = new Set<string>(AGENT_SCOPES)

/** Keep matching `resource:verb` tokens; otherwise every read scope. */
export function parseRequestedAgentScopes(
  raw: string | undefined,
): Array<AgentScope> {
  const tokens = (raw ?? '').split(/[\s+]+/).filter(Boolean)
  const matched = tokens.filter((token): token is AgentScope =>
    AGENT_SCOPE_SET.has(token),
  )
  if (matched.length === 0) return [...READ_SCOPES]
  return [...new Set(matched)]
}

export function scopeMessageKey(
  scope: AgentScope,
): `settings.agents.scope.${AgentResource}.${AgentVerb}` {
  const [resource, verb] = scope.split(':') as [AgentResource, AgentVerb]
  return `settings.agents.scope.${resource}.${verb}`
}
