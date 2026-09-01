/**
 * Everything the auth layer reads from the Worker environment, in one place.
 *
 * This module imports `cloudflare:workers`, so it is the boundary between the parts of the auth
 * layer that can be exercised in a plain Node test (`./tenant`, `./permissions`, `./organization`,
 * `./guards` — all of which take their inputs as arguments) and the parts that cannot. Nothing on
 * the testable side may import this file, and nothing here does any work beyond reading a binding.
 *
 * Every accessor is a **function**, never a module-level constant: bindings exist only inside a
 * request, and a constant evaluated at module load would capture `undefined` at build time.
 */

import { env } from 'cloudflare:workers'

/** Product name. Used in auth copy, in email subjects and as the TOTP issuer. */
export const APP_NAME = 'money-tracker.online'

/**
 * Reads a required secret, failing loudly at the first request rather than silently signing sessions
 * with `undefined`. A Worker without this secret is misconfigured, not degraded.
 */
function requireSecret(name: 'BETTER_AUTH_SECRET'): string {
  const value = env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Missing ${name}. Set it with \`wrangler secret put ${name}\` (or in .dev.vars for local development).`,
    )
  }
  return value
}

/**
 * Origin the app is served from. Every auth URL — reset links, callbacks — is built from this.
 *
 * The fallback is the port `pnpm dev` actually binds (`server.port` in `vite.config.ts`, with
 * `strictPort`), not a generic 3000: a wrong origin here does not fail loudly, it emails a
 * verification link pointing at a dead port.
 */
export function appUrl(): string {
  const configured = env.APP_URL
  if (typeof configured === 'string' && configured.length > 0) {
    return configured.replace(/\/+$/, '')
  }
  return 'http://localhost:3010'
}

export function authSecret(): string {
  return requireSecret('BETTER_AUTH_SECRET')
}

/**
 * Origins accepted for OAuth callbacks and WebAuthn assertions.
 *
 * In development the loopback origins are wildcarded by port: `vite dev` falls back to the next free
 * port when its configured one is taken, and pinning the list to a single port turns every auth
 * request into a `403 Invalid origin`. Production stays strict — only the configured `APP_URL`.
 */
export function trustedOrigins(): Array<string> {
  const configured = new URL(appUrl()).origin
  if (!import.meta.env.DEV) return [configured]
  return [...new Set([configured, 'http://localhost:*', 'http://127.0.0.1:*'])]
}

interface ProviderCredentials {
  readonly clientId: string
  readonly clientSecret: string
}

function credentials(
  clientId: string | undefined,
  clientSecret: string | undefined,
): ProviderCredentials | null {
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/** Google OAuth credentials, or `null` when the provider is not configured. */
export function googleCredentials(): ProviderCredentials | null {
  return credentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)
}

/** Apple OAuth credentials, or `null` when the provider is not configured. */
export function appleCredentials(): ProviderCredentials | null {
  return credentials(env.APPLE_CLIENT_ID, env.APPLE_CLIENT_SECRET)
}

export function appleBundleIdentifier(): string | undefined {
  return env.APPLE_APP_BUNDLE_IDENTIFIER
}

export function d1(): D1Database {
  return env.DB
}

/**
 * The `SESSIONS` namespace, separate from the general `KV` cache on purpose: a cache purge must
 * never sign everyone out (ADR 0011).
 */
export function sessionStore(): KVNamespace {
  return env.SESSIONS
}

/** Transactional email configuration, or `null` when the key is unset. See `./email`. */
export function emailDelivery(): {
  readonly apiKey: string
  readonly apiUrl: string
  readonly from: string
} | null {
  const apiKey = env.EMAIL_API_KEY
  if (typeof apiKey !== 'string' || apiKey.length === 0) return null
  return { apiKey, apiUrl: env.EMAIL_API_URL, from: env.EMAIL_FROM }
}

/** `vars` the logger needs. Passed to `loggerFromEnv` rather than re-read there. */
export function loggerEnv(): { LOG_LEVEL?: unknown; ENVIRONMENT?: unknown } {
  return { LOG_LEVEL: env.LOG_LEVEL, ENVIRONMENT: env.ENVIRONMENT }
}
