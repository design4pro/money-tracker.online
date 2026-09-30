/**
 * What the email layer reads from the Worker environment, in one place.
 *
 * This module imports `cloudflare:workers`, so it is the boundary between the testable side of
 * `src/server/email` — which takes keys and clocks as arguments — and the parts that cannot run in
 * a plain Node test. Nothing on the testable side imports it.
 *
 * Every accessor is a function, never a module-level constant: bindings exist only inside a
 * request, and a constant evaluated at module load would capture `undefined` at build time.
 */

import { env } from 'cloudflare:workers'

import type { UnsubscribeKeys } from './unsubscribe-token'

function readString(name: string): string | null {
  // Read by name, like `#/server/billing/env`, because the two optional secrets are not declared
  // in `worker-configuration.d.ts` yet.
  const value = (env as unknown as Record<string, unknown>)[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The unsubscribe signing keys, or `null` when `UNSUBSCRIBE_TOKEN_SECRET` is unset.
 *
 * `null` makes the feature a loud no-op, never a crash: every link renders invalid, the one-click
 * endpoint answers `400`, and the route logs why.
 */
export function unsubscribeKeys(): UnsubscribeKeys | null {
  const current = readString('UNSUBSCRIBE_TOKEN_SECRET')
  if (!current) return null
  return {
    current,
    previous: readString('UNSUBSCRIBE_TOKEN_SECRET_PREVIOUS'),
  }
}
