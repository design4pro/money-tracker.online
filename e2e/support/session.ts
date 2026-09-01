import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test'

/**
 * The `playwright` worker fixture, taken from the fixture table rather than named directly:
 * `@playwright/test` exports no `Playwright` type of its own.
 */
type Playwright = PlaywrightWorkerArgs['playwright']

/**
 * The sessions the suite runs as, and the one place that knows how to obtain one.
 *
 * ## Why sessions are minted through the API and cached, not typed into the form
 *
 * `/sign-in/email` is rate limited to ten attempts a minute and `/sign-up/email` to five every
 * five minutes (`src/server/auth/config.ts`). A suite that signs in per test walks into a `429`
 * on its own fixtures and then reports it as a product failure. So every session is minted once
 * by the `setup` project and cached as storage state, and the specs adopt it.
 *
 * The one exception is deliberate: `core-flow.spec.ts` signs up through the register screen,
 * because "signing up provisions a workspace" is the behaviour under test rather than a fixture.
 * That costs exactly one sign-up per run, which is what leaves headroom under the window.
 *
 * ## Why the fixture workspaces are stable accounts rather than fresh ones
 *
 * Tenant A and tenant B exist so the tenant boundary can be attacked in the running application.
 * If they were created fresh every run, a suite run twice inside five minutes would exhaust the
 * sign-up limit and fail for a reason that has nothing to do with tenancy. They are therefore
 * created on the first run and signed into on every one after, and each test creates its own
 * uniquely named rows inside them.
 */

export interface Credentials {
  readonly name: string
  readonly email: string
  readonly password: string
}

/**
 * The seeded demo workspace: five accounts, three currencies, ~600 transactions.
 * `scripts/seed/seed.mjs` builds it and the credential is a committed fixture for a local
 * database. The suite only ever *reads* it, so a run leaves the counters `verify.mjs` asserts
 * exactly where it found them.
 */
export const DEMO: Credentials = {
  name: 'Demo Household',
  email: 'demo@money-tracker.online',
  password:
    process.env.E2E_PASSWORD ?? process.env.DEMO_PASSWORD ?? 'money-demo-2026',
}

/** The password every fixture workspace uses. Twelve characters, which is the server minimum. */
const FIXTURE_PASSWORD = process.env.E2E_FIXTURE_PASSWORD ?? 'e2e-fixture-2026'

/** The workspace whose rows tenant B will try to reach. */
export const TENANT_A: Credentials = {
  name: 'E2E Tenant A',
  email: 'e2e-tenant-a@money-tracker.online',
  password: FIXTURE_PASSWORD,
}

/** The workspace that must be refused. */
export const TENANT_B: Credentials = {
  name: 'E2E Tenant B',
  email: 'e2e-tenant-b@money-tracker.online',
  password: FIXTURE_PASSWORD,
}

const AUTH_DIR = fileURLToPath(new URL('../.auth/', import.meta.url))

/** Where one session's cookies are cached. Keep the ids in step with `auth.setup.ts`. */
export function storageStateFor(id: 'demo' | 'tenant-a' | 'tenant-b'): string {
  return `${AUTH_DIR}${id}.json`
}

/**
 * Signs in, signing up first when the account is not there yet.
 *
 * Sign-in is tried before sign-up on purpose: on every run after the first the fixture accounts
 * already exist, and asking for a sign-up we know will be refused would spend a slot in the
 * five-per-five-minutes window to learn something the sign-in already told us.
 */
export async function ensureSignedIn(
  api: APIRequestContext,
  credentials: Credentials,
): Promise<void> {
  const signIn = await api.post('/api/auth/sign-in/email', {
    data: {
      email: credentials.email,
      password: credentials.password,
      rememberMe: true,
    },
  })
  if (signIn.ok()) return

  const signUp = await api.post('/api/auth/sign-up/email', {
    data: {
      name: credentials.name,
      email: credentials.email,
      password: credentials.password,
    },
  })
  if (signUp.ok()) return

  throw new Error(
    `could not obtain a session for ${credentials.email}: ` +
      `sign-in ${signIn.status()} ${await signIn.text()}, ` +
      `sign-up ${signUp.status()} ${await signUp.text()}`,
  )
}

/**
 * An API context that Better Auth will answer.
 *
 * The `Origin` header is not decoration: Better Auth answers a credentialed POST without one with
 * `403 MISSING_OR_NULL_ORIGIN`, and Playwright's request contexts do not send one by default.
 */
export async function apiContext(
  playwright: Playwright,
  baseURL: string,
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { origin: baseURL },
  })
}

/** Mints a session and writes it where the specs expect to find it. */
export async function cacheSession(
  playwright: Playwright,
  baseURL: string,
  credentials: Credentials,
  id: 'demo' | 'tenant-a' | 'tenant-b',
): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true })
  const api = await apiContext(playwright, baseURL)
  try {
    await ensureSignedIn(api, credentials)
    await api.storageState({ path: storageStateFor(id) })
  } finally {
    await api.dispose()
  }
}
