/**
 * Mint, list and revoke agent grants. Tools themselves are a later phase.
 *
 * The repository asserts owner/admin. This file adds the paid-plan gate on mint
 * ({@link FeatureLockedError} `mcp`) and leaves revoke available on a locked plan so an owner
 * can clean up after they cancel.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { appUrl } from '#/server/auth/env'
import { requireOrg } from '#/server/auth/guards'
import { resolveLimits } from '#/server/billing/resolve-limits'
import { mcpResourceUrl } from '#/server/mcp/resource'
import {
  createOauthGrant,
  createOauthGrantSchema,
  createPatGrant,
  createPatGrantSchema,
  listGrants,
  revokeGrant,
  revokeGrantSchema,
  updateAgentGrant as updateAgentGrantRow,
  updateAgentGrantSchema,
} from '#/server/repos/agent-grants'
import { FeatureLockedError } from '#/server/repos/errors'
import { workspaceName } from '#/server/repos/members'

import type { AgentPatEnvironment } from '#/lib/enums'
import type { AgentGrantView, MintedPat } from '#/server/repos/agent-grants'

export type AgentsPageView =
  | { readonly kind: 'member'; readonly mcpUrl: string }
  | {
      readonly kind: 'locked' | 'ready'
      readonly mcpUrl: string
      readonly grants: ReadonlyArray<AgentGrantView>
    }

export type ConsentPageView = {
  readonly workspaceName: string
  readonly mcpEnabled: boolean
  readonly canManage: boolean
}

const mintSchema = createPatGrantSchema.omit({ environment: true }).extend({
  environment: z.enum(['stg', 'live']).optional(),
})

function patEnvironmentFromAppUrl(): AgentPatEnvironment {
  try {
    const host = new URL(appUrl()).hostname
    if (
      host === 'money-tracker.online' ||
      host === 'www.money-tracker.online'
    ) {
      return 'live'
    }
  } catch {
    // Fall through to staging: a misconfigured origin must not mint a live-looking secret.
  }
  return 'stg'
}

export const loadAgentGrants = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReadonlyArray<AgentGrantView>> => {
    return listGrants(await requireOrg())
  },
)

export const loadAgentsPage = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AgentsPageView> => {
    const scope = await requireOrg()
    const mcpUrl = mcpResourceUrl()
    if (scope.ctx.role === 'member') {
      return { kind: 'member', mcpUrl }
    }
    const grants = (await listGrants(scope)).filter(
      (grant) => grant.revokedAt == null,
    )
    const mcpEnabled = (await resolveLimits(scope)).features.mcp
    return { kind: mcpEnabled ? 'ready' : 'locked', mcpUrl, grants }
  },
)

export const loadConsentPage = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ConsentPageView> => {
    const scope = await requireOrg()
    const mcpEnabled = (await resolveLimits(scope)).features.mcp
    return {
      workspaceName: await workspaceName(scope),
      mcpEnabled,
      canManage: scope.ctx.role !== 'member',
    }
  },
)

export const recordOauthGrant = createServerFn({ method: 'POST' })
  .inputValidator(createOauthGrantSchema)
  .handler(async ({ data }): Promise<AgentGrantView> => {
    const scope = await requireOrg()
    const effective = await resolveLimits(scope)
    if (!effective.features.mcp) {
      throw new FeatureLockedError('mcp')
    }
    return createOauthGrant(scope, data, new Date())
  })

export const mintAgentPat = createServerFn({ method: 'POST' })
  .inputValidator(mintSchema)
  .handler(async ({ data }): Promise<MintedPat> => {
    const scope = await requireOrg()
    const effective = await resolveLimits(scope)
    if (!effective.features.mcp) {
      throw new FeatureLockedError('mcp')
    }
    return createPatGrant(
      scope,
      {
        name: data.name,
        scopes: data.scopes,
        environment: data.environment ?? patEnvironmentFromAppUrl(),
      },
      new Date(),
    )
  })

export const revokeAgentGrant = createServerFn({ method: 'POST' })
  .inputValidator(revokeGrantSchema)
  .handler(async ({ data }): Promise<AgentGrantView> => {
    return revokeGrant(await requireOrg(), data, new Date())
  })

export const updateAgentGrant = createServerFn({ method: 'POST' })
  .inputValidator(updateAgentGrantSchema)
  .handler(async ({ data }): Promise<AgentGrantView> => {
    const scope = await requireOrg()
    const effective = await resolveLimits(scope)
    if (!effective.features.mcp) {
      throw new FeatureLockedError('mcp')
    }
    return updateAgentGrantRow(scope, data, new Date())
  })
