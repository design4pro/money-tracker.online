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

/**
 * A workspace with nothing in it, so the empty states can be photographed rather than described.
 *
 * ## Read-only, and that is a contract rather than a habit
 *
 * `DEMO` is read-only because a run must leave `verify.mjs`'s counters where it found them. This
 * one is read-only for a stronger reason: *empty* is the whole of what it provides. One test that
 * creates an account here to check something unrelated silently turns every empty-state assertion
 * in `states.spec.ts` into an assertion about a workspace with one account in it — and it fails on
 * the *next* run, in a different file, for a reason that is nowhere near the change that caused it.
 *
 * So nothing writes through this session. A test that needs rows uses {@link TENANT_A} or
 * {@link TENANT_B}, which exist to be written to and whose tests each name their own rows.
 *
 * It is a separate account rather than tenant B emptied between runs because emptying is a write,
 * and a suite that empties a workspace it also runs tests against has an ordering problem the
 * moment two files run in parallel.
 */
export const EMPTY: Credentials = {
  name: 'E2E Empty Workspace',
  email: 'e2e-empty@money-tracker.online',
  password: FIXTURE_PASSWORD,
}

const AUTH_DIR = fileURLToPath(new URL('../.auth/', import.meta.url))

/** One cached session. Keep the ids in step with `auth.setup.ts`. */
export type SessionId = 'demo' | 'tenant-a' | 'tenant-b' | 'empty'

/** Where one session's cookies are cached. */
export function storageStateFor(id: SessionId): string {
  return `${AUTH_DIR}${id}.json`
}

/**
 * How long to wait out a `429`, and how many times.
 *
 * The sign-in window is ten attempts a minute, so a full minute is the only wait that is certain to
 * clear it; two of them is the budget. Three fixture workspaces and the demo session are four
 * sign-ins per run, which is well under the limit — this exists for the case where two runs of the
 * suite overlap on one machine, which is the ordinary shape of a local re-run while CI is going.
 */
const RATE_LIMIT_WAIT_MS = 60_000
const RATE_LIMIT_ATTEMPTS = 2

/**
 * The longest one sign-in can take when the limiter is firing.
 *
 * Exported because the waiting above is only real if the test doing it is allowed to last that
 * long: `playwright.config.ts` puts 30s on every test and the `setup` project does not override it,
 * so without this budget a `429` would end as a timeout with none of the diagnosis the wait exists
 * to provide. `auth.setup.ts` multiplies it by the number of sign-ins each of its steps performs.
 */
export const RATE_LIMIT_BUDGET_MS = RATE_LIMIT_ATTEMPTS * RATE_LIMIT_WAIT_MS

const HTTP_TOO_MANY_REQUESTS = 429

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Signs in, signing up first when the account is not there yet.
 *
 * Sign-in is tried before sign-up on purpose: on every run after the first the fixture accounts
 * already exist, and asking for a sign-up we know will be refused would spend a slot in the
 * five-per-five-minutes window to learn something the sign-in already told us.
 *
 * A `429` is waited out rather than reported. It is the one status here that says nothing about the
 * product: the limiter is doing exactly what `src/server/auth/config.ts` asks it to, and a suite
 * that fails on its own fixtures' rate limit reports an outage that does not exist. Every other
 * refusal is raised immediately with both responses quoted.
 */
export async function ensureSignedIn(
  api: APIRequestContext,
  credentials: Credentials,
): Promise<void> {
  const attemptSignIn = () =>
    api.post('/api/auth/sign-in/email', {
      data: {
        email: credentials.email,
        password: credentials.password,
        rememberMe: true,
      },
    })

  let signIn = await attemptSignIn()
  for (
    let attempt = 0;
    signIn.status() === HTTP_TOO_MANY_REQUESTS && attempt < RATE_LIMIT_ATTEMPTS;
    attempt += 1
  ) {
    await sleep(RATE_LIMIT_WAIT_MS)
    signIn = await attemptSignIn()
  }

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
  id: SessionId,
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
