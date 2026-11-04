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
import {
  createPatGrant,
  createPatGrantSchema,
  listGrants,
  revokeGrant,
  revokeGrantSchema,
} from '#/server/repos/agent-grants'
import { FeatureLockedError } from '#/server/repos/errors'

import type { AgentPatEnvironment } from '#/lib/enums'
import type { AgentGrantView, MintedPat } from '#/server/repos/agent-grants'

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
