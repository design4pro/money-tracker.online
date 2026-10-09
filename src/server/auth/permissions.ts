/**
 * The **platform** access dictionary, and the one predicate that answers "may this actor do this".
 *
 * Two role vocabularies exist in this product and they are never mixed (`docs/SPEC.md` §5.3):
 *
 * | dictionary | values | column | meaning |
 * |---|---|---|---|
 * | **platform** (here) | `admin \| curator \| user` | `user.role` | authority over the *product* — the catalogue, the console, other people's accounts |
 * | **workspace** (`src/server/repos/scope.ts`) | `owner \| admin \| member` | `member.role` | authority inside *one workspace* |
 *
 * They share the word `admin` and mean unrelated things by it. A helper taking "a role" without
 * saying which one is a defect, not a naming quibble — so the two are separate TypeScript types with
 * no overlap in their union members beyond that shared literal, and `__tests__/permissions.test.ts`
 * holds a type-level assertion proving one cannot be passed where the other is wanted.
 *
 * **This module is binding-free by construction**, and that is load-bearing rather than tidy: the
 * console screens, the guards and the tests all read the same grid, and they cannot share a runtime.
 * Its only runtime imports are two `better-auth` access subpaths. Nothing here reaches a Worker
 * binding, a database or a `node:` builtin.
 *
 * {@link permits} is a **pure predicate**: no database read, no cache read, no audit write, nothing
 * to await. A guard that did work of its own would run *after* something, and the moment it can run
 * after a mutation it has stopped being a boundary. It is also what the console's render flags are
 * derived from, so a button cannot appear for an action the guard will refuse.
 */

import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/admin/access'

import type { AdminOptions } from 'better-auth/plugins/admin'

/**
 * The closed set of platform resources and the actions each carries.
 *
 * `catalog` is the global money data the finance domain reads and nobody else may write:
 * `currencies`, `exchange_rates`, `brand_logos` — the one carve-out from the tenant-scoped
 * repository boundary (ADR 0002), which is why writing it is a platform statement rather than a
 * workspace one. `plan` governs the price catalogue and grandfathered ceilings; `support` is the
 * read-only workspace lookup a person answering a ticket needs.
 *
 * A new resource, or a new action on an existing one, is an amendment to `docs/SPEC.md` §5.3 in the
 * same commit — not a line added here on the way past.
 */
export const statement = {
  ...defaultStatements,
  catalog: ['read', 'write'],
  plan: ['read', 'write'],
  support: ['read'],
} as const

export const ac = createAccessControl(statement)

export type PlatformStatement = typeof statement
export type PlatformResource = keyof PlatformStatement

/**
 * What a caller asks for: `{ catalog: ['write'] }`, `{ user: ['ban'] }`.
 *
 * Every listed action must be held for the request to succeed and an empty request is a denial —
 * both are Better Auth's `authorize` semantics under its default `AND` connector, and neither is
 * re-implemented here.
 */
export type PlatformPermissionRequest = {
  readonly [Resource in PlatformResource]?: ReadonlyArray<
    PlatformStatement[Resource][number]
  >
}

/**
 * Full platform authority.
 *
 * Built from {@link statement} rather than inherited from Better Auth's own `adminAc`: inheriting
 * would make every cell in this grid the dependency's opinion, and would follow it silently the day
 * a minor release changes its mind.
 */
export const adminRole = ac.newRole({
  user: [
    'create',
    'list',
    'set-role',
    'ban',
    'impersonate',
    'delete',
    'set-password',
  ],
  session: ['list', 'revoke', 'delete'],
  catalog: ['read', 'write'],
  plan: ['read', 'write'],
  support: ['read'],
})

/**
 * The money catalogue and nothing else: currencies, exchange rates, brand logos.
 *
 * `user`, `session` and `plan` are declared **empty rather than omitted**, so the denial is a
 * statement this file makes rather than a key nobody wrote.
 */
export const curatorRole = ac.newRole({
  user: [],
  session: [],
  catalog: ['read', 'write'],
  plan: [],
  support: ['read'],
})

/** Everyone else, which is nearly everyone. No platform surface at all. */
export const userRole = ac.newRole({
  user: [],
  session: [],
  catalog: [],
  plan: [],
  support: [],
})

/**
 * The complete role set, and the only place the three platform role names are enumerated.
 *
 * Better Auth's `admin` plugin resolves `user.role` against whatever object it is handed, so an
 * incomplete map here is not a type error anywhere: a missing `curator` key would simply deny
 * everything, quietly. Passing this whole object to the plugin *and* reading it in {@link permits}
 * is what keeps one answer to "what may this role do".
 */
export const roles = {
  admin: adminRole,
  curator: curatorRole,
  user: userRole,
} as const

/** `admin`, `curator` or `user`. Derived from {@link roles} so the vocabulary is declared once. */
export type PlatformRole = keyof typeof roles

/**
 * Most privileged first.
 *
 * `user.role` stores a comma-joined string for a multi-role account and Better Auth splits it the
 * same way, so `'curator,user'` has to resolve to the strongest name it carries rather than to
 * whichever happens to come first.
 */
export const PLATFORM_ROLES_BY_PRECEDENCE = [
  'admin',
  'curator',
  'user',
] as const satisfies ReadonlyArray<PlatformRole>

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && Object.hasOwn(roles, value)
}

/**
 * The `user.role` column as one of the three platform roles.
 *
 * `null` resolves to `user` because the column has no default and no `CHECK`; an unrecognised value
 * resolves to `user` because deny-by-default is the only safe reading of a string nobody declared.
 * Neither is ever read as "unset, therefore permissive".
 *
 * The parts are compared exactly as `split(',')` produces them, whitespace and all — Better Auth's
 * own check does the same, and trimming here would make one column value read as `admin` in this
 * predicate and as an undeclared role inside the plugin.
 */
export function resolvePlatformRole(role: string | null): PlatformRole {
  if (role === null) return 'user'
  const held = new Set(role.split(','))
  return (
    PLATFORM_ROLES_BY_PRECEDENCE.find((candidate) => held.has(candidate)) ??
    'user'
  )
}

/** The facts about an actor that decide a platform permission. Nothing else is consulted. */
export interface PlatformActor {
  /** `user.role`, verbatim. */
  readonly role: string | null
  /** A ban is a veto on top of a role, not a change to one. */
  readonly banned: boolean
  /**
   * The operator wearing this account, when the session was minted by impersonation.
   *
   * A curator being impersonated does not lend its `catalog:write` to the operator wearing it, so
   * every platform statement is refused for the duration.
   */
  readonly impersonatedBy: string | null
}

/**
 * Whether `actor` holds every statement in `request`. Pure, synchronous, total.
 *
 * The order of the three refusals is deliberate. Ban first: it is the fact about the *account* and
 * it survives ending the impersonation. Then impersonation. Then the role grid.
 */
export function permits(
  actor: PlatformActor | null,
  request: PlatformPermissionRequest,
): boolean {
  if (!actor) return false
  if (actor.banned) return false
  if (actor.impersonatedBy !== null) return false
  return roles[resolvePlatformRole(actor.role)].authorize(request).success
}

/**
 * Fifteen minutes: long enough to reproduce a support report, short enough that an unattended laptop
 * expires before its owner is back with coffee.
 */
export const IMPERSONATION_SESSION_SECONDS = 900

/**
 * What a suspended account is told at the transport level.
 *
 * Declared here rather than in screen copy because the plugin throws it out of
 * `session.create.before`, before any request has negotiated a language: there is no locale to key a
 * translation against at that moment. The auth screens map the `BANNED_USER` **code** onto i18n
 * keys; they never render this sentence.
 */
export const BANNED_USER_MESSAGE =
  'This account is suspended and cannot sign in.'

/**
 * Exactly the options the production `betterAuth()` call passes to `admin()`.
 *
 * Three of these are silent-failure traps rather than preferences:
 *
 * - `roles` must be the **complete** three-role set. The plugin reads `options.roles || defaultRoles`
 *   and `defaultRoles` has no `curator`; passing `ac` without `roles` denies every curator statement
 *   with no error and no warning.
 * - `adminRoles` is validated against `Object.keys(roles)` **synchronously inside `admin()`**, which
 *   sits inside the memoised auth builder — so a name that is not a declared role is a dead Worker
 *   on every page including anonymous marketing, not a 500 on one route.
 * - `impersonationSessionDuration` silently falls back to an hour when omitted.
 *
 * And one key is absent rather than empty: `adminUserIds`. An id in that list short-circuits the
 * plugin's own permission check to `true` before `permissions` is examined, while reading as a plain
 * `user` everywhere a person could look. An empty array in source is a slot, and a slot gets filled
 * at 2 a.m., so there is no slot.
 */
export const adminOptions = {
  ac,
  roles,
  adminRoles: ['admin'],
  defaultRole: 'user',
  impersonationSessionDuration: IMPERSONATION_SESSION_SECONDS,
  bannedUserMessage: BANNED_USER_MESSAGE,
} satisfies AdminOptions

/**
 * The `admin` plugin's HTTP paths, every one of them closed.
 *
 * Matching happens against the request path with `basePath` already stripped, so the entries are
 * written `/admin/set-role` and not `/api/auth/admin/set-role` — the second spelling matches nothing
 * and closes nothing. A match returns a bare `404` before rate limiting and before the endpoint is
 * entered: the surface is removed rather than guarded.
 *
 * `auth.api.*` never passes through the router, so this shuts the browser door while leaving the
 * same actions fully usable in-process behind {@link permits}. That asymmetry is why `disabledPaths`
 * is the instrument and a `hooks.before` guard is not — the latter wraps `auth.api` too, and would
 * leave no way to perform the action at all.
 *
 * The declared type is mutable because `BetterAuthOptions['disabledPaths']` is `string[]`. The
 * config spreads this array into `disabledPaths` and a drift test compares against it, so the
 * running Worker and the test cannot read two different lists. Nothing mutates it.
 */
export const DISABLED_ADMIN_PATHS: string[] = [
  '/admin/ban-user',
  '/admin/create-user',
  '/admin/get-user',
  '/admin/has-permission',
  '/admin/impersonate-user',
  '/admin/list-user-sessions',
  '/admin/list-users',
  '/admin/remove-user',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/admin/set-role',
  '/admin/set-user-password',
  '/admin/stop-impersonating',
  '/admin/unban-user',
  '/admin/update-user',
]

/**
 * The `organization` plugin's creation path, closed on the HTTP surface.
 *
 * Nothing in the product posts to it, and left open it lets a signed-in user mint unlimited
 * owner-role organizations with no base currency; one created before provisioning is what
 * `firstOrganizationIdFor` returns, so that user never gets a personal workspace. Spelled without
 * `/api/auth`, for the reason {@link DISABLED_ADMIN_PATHS} gives.
 *
 * Only this one path: `allowUserToCreateOrganization` stays on, because plan stage 26-S1 creates
 * workspaces in-process with `auth.api.createOrganization`, which never passes through the router.
 */
export const DISABLED_ORGANIZATION_PATHS: string[] = ['/organization/create']
