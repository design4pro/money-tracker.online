/**
 * Everything billing reads from the Worker environment, in one place.
 *
 * This module imports `cloudflare:workers`, which makes it the boundary between the parts of the
 * billing layer that run in a plain Node test — the client, the verifier, the mapping and the
 * resolver, all of which take their inputs as arguments — and the parts that cannot. Nothing on
 * the testable side imports this file.
 *
 * Every accessor is a function, never a module-level constant: bindings exist only inside a
 * request, and a constant evaluated at module load would capture `undefined` at build time.
 *
 * **An unconfigured deployment is a loud one.** Billing is optional (`.dev.vars.example` says so),
 * and the product runs perfectly without it — the free plan is a complete product. What must never
 * happen is a half-working checkout: {@link requirePolarClient} throws {@link BillingConfigError}
 * naming the missing secret, and the screens render an honest "billing is not configured here"
 * instead of a button that opens a broken page.
 */

import { env } from 'cloudflare:workers'

import { createPolarClient } from './polar-client'

import type { PolarClient, PolarServer } from './polar-client'

/** A billing action was attempted on a deployment that has no billing credentials. */
export class BillingConfigError extends Error {
  readonly missing: string

  constructor(missing: string) {
    super(
      `Billing is not configured: ${missing} is unset. Set it with \`wrangler secret put ${missing}\` (or in .dev.vars for local development).`,
    )
    this.name = 'BillingConfigError'
    this.missing = missing
  }
}

function readString(name: string): string | null {
  const value = (env as unknown as Record<string, unknown>)[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** `sandbox` or `production`, and nothing else. No default: the two are separate Polar accounts. */
function polarServer(): PolarServer | null {
  const value = readString('POLAR_SERVER')
  return value === 'sandbox' || value === 'production' ? value : null
}

/** Whether this deployment can talk to Polar at all. Read by the screens before they offer to. */
export function isBillingConfigured(): boolean {
  return readString('POLAR_ACCESS_TOKEN') !== null && polarServer() !== null
}

/** The client, or a throw naming the one secret that is missing. */
export function requirePolarClient(): PolarClient {
  const accessToken = readString('POLAR_ACCESS_TOKEN')
  if (!accessToken) throw new BillingConfigError('POLAR_ACCESS_TOKEN')
  const server = polarServer()
  if (!server) throw new BillingConfigError('POLAR_SERVER')
  return createPolarClient({ accessToken, server })
}

/**
 * The webhook signing secret.
 *
 * Absent, the endpoint answers 503 rather than accepting an unverified body: a webhook nobody can
 * verify is a public entitlement grant.
 */
export function polarWebhookSecret(): string | null {
  return readString('POLAR_WEBHOOK_SECRET')
}
