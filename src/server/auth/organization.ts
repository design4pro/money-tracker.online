/**
 * Workspace provisioning: every account has a workspace, so nothing in the product is org-less.
 *
 * `organization` **is** the tenant (blueprint §3.2). Every finance table carries its id, every guard
 * resolves one, and every repository query filters on it — so an account without one is an account
 * for which every authenticated screen fails. This module makes that state unreachable.
 *
 * It runs from **two** Better Auth hooks, and both are needed:
 *
 * - `user.create.after` — the natural place, and the one that gives a brand-new account its
 *   workspace.
 * - `session.create.before` — because sign-up creates the user row and the session row in the same
 *   request and Better Auth does not await the first hook before running the second, so reading
 *   memberships alone loses the race and strands a brand-new session with a null active workspace.
 *   It also covers the accounts that existed before this shipped.
 *
 * {@link provisionPersonalWorkspace} is idempotent for a user that already has a workspace, and the
 * workspace id is a pure function of the user id, so the primary key keeps two concurrent calls to
 * one workspace per user rather than duplicating it.
 *
 * Every function takes its database handle as an argument and none of them reaches a binding, so the
 * whole module is exercised against real SQLite in `__tests__/organization.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * THE BASE CURRENCY, AND WHY IT IS WRITTEN HERE OF ALL PLACES
 * ---------------------------------------------------------------------------
 * An earlier draft of this module recorded the base currency as a known gap, on the reading that it
 * belonged in an `organization_settings` table that does not exist. It does not need one:
 * `organization_currencies` is in the schema, its partial unique index already enforces *one base
 * per workspace*, and `organization_currencies.currency_code` is a foreign key onto the global
 * `currencies` catalogue (seeded by `drizzle/0002_seed_currency_catalogue.sql`).
 *
 * Without that row nothing in the product works — `conversionContextFor` cannot name a base, so
 * every `ref_amount_minor` is undefined, so no account and no transaction can be written. So the
 * rows go into **the same `db.batch`** as the organization and the membership, and that is the
 * whole reason this one finance table is written outside `src/server/repos`: a repository call
 * needs a `TenantScope`, a scope needs an `organizationId`, and the workspace it would name is
 * being created by the very statement that would have to precede it. There is no scope to have
 * yet. Splitting the write out of the batch to satisfy the layering rule would buy a tidier import
 * graph at the price of a workspace that can exist without a base currency — which is precisely the
 * state this batch exists to make unreachable.
 */

import { and, asc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import {
  member,
  organization,
  user as userTable,
} from '#/server/db/auth-schema'
import {
  DEFAULT_BASE_CURRENCY_CODE,
  DEFAULT_WORKSPACE_CURRENCY_CODES,
} from '#/server/catalog/data/currencies'
import {
  organizationCurrencies,
  organizationSettings,
} from '#/server/db/schema'
import { DEFAULT_WORKSPACE_TIMEZONE } from '#/server/calendar-day'

import type { SQL } from 'drizzle-orm'

import type { OrganizationRole } from '#/server/db/auth-schema'
import type { AppDatabase } from './db'

/** Matches `advanced.database.generateId`, so every id in the auth tables has one shape. */
function newAuthId(): string {
  return nanoid(24)
}

/** Turns arbitrary text into a URL-safe slug fragment. Empty when nothing usable survives. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * The display name of a new account's personal workspace.
 *
 * The person's own name, or the local part of their address — and deliberately **no English word
 * appended**. This string is written to the database at sign-up, before any language has been
 * negotiated, and it is never re-rendered through the message catalogue afterwards; a workspace
 * called "Anna's budget" would be permanently English for a Polish household, and translating it
 * later would mean rewriting stored data. A name the reader recognises and can rename is the honest
 * answer to a string i18n cannot reach.
 */
export function personalWorkspaceName(input: {
  name?: string | null
  email: string
}): string {
  const trimmed = input.name?.trim()
  if (trimmed) return trimmed
  return input.email.split('@')[0] ?? 'workspace'
}

/** Candidate slug for a personal workspace, before uniqueness is applied. */
export function personalWorkspaceSlug(input: {
  name?: string | null
  email: string
}): string {
  const base =
    slugify(input.name ?? '') || slugify(input.email.split('@')[0] ?? '')
  return base || 'workspace'
}

/** Prefix of the hashed input, so the id cannot coincide with a hash of the bare user id. */
const PERSONAL_WORKSPACE_ID_PREFIX = 'mtr:personal-workspace:'

/** How many times {@link provisionPersonalWorkspace} submits its batch before giving up. */
const MAX_PROVISION_ATTEMPTS = 4

/**
 * The id of a user's auto-provisioned personal workspace: a pure function of the user id.
 *
 * Nothing in the schema is unique per user (`member` is unique on the pair, `organization` on the
 * slug), so two provisions of one user would otherwise both commit. With the id derived from the
 * user, they insert the same primary key and exactly one batch wins, whichever slug each drew.
 *
 * The hash is plain and unkeyed on purpose. An HMAC keyed with the auth secret would stop being
 * deterministic the day the secret rotates, and the id protects nothing by being secret:
 * `requireOrg` treats a workspace id as an assertion checked against `member`, never a selector.
 * 24 base64url characters, the shape of every other id in the auth tables.
 */
export async function personalWorkspaceId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${PERSONAL_WORKSPACE_ID_PREFIX}${userId}`),
  )
  // 18 bytes are exactly 24 base64 characters, so there is no padding to strip.
  return btoa(String.fromCharCode(...new Uint8Array(digest).slice(0, 18)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

/** How many random suffixes are tried before the unconditionally-unique fallback. */
const SLUG_RETRIES = 3

/**
 * Finds a free slug, appending a short random suffix on collision.
 *
 * `organization.slug` carries a unique index, so a collision is a failed insert rather than a
 * duplicate — and two people called Anna signing up in the same minute is not an edge case. The
 * ladder is bounded and its last rung is long enough to be unique without another read.
 *
 * This is a read followed by a write, so it narrows the window and does not close it: two callers
 * can read the same free slug. {@link provisionPersonalWorkspace} owns the retry that closes it,
 * and its primary key keeps one user to one workspace.
 */
export async function reserveSlug(
  db: AppDatabase,
  base: string,
): Promise<string> {
  const candidates = [
    base,
    ...Array.from(
      { length: SLUG_RETRIES },
      () => `${base}-${nanoid(6).toLowerCase()}`,
    ),
  ]

  for (const candidate of candidates) {
    const clash = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, candidate))
      .limit(1)
    if (clash.length === 0) return candidate
  }

  return `${base}-${nanoid(12).toLowerCase()}`
}

/**
 * Creates the user's personal workspace and their `owner` membership, in **one `db.batch`**.
 *
 * One batch rather than two statements: D1 has no interactive transactions, and an `organization`
 * row whose `member` row failed to write is a workspace its owner cannot enter and nothing will ever
 * clean up. The batch is atomic and is also a single network hop, which matters on a sign-up path.
 *
 * Idempotent: an account that already belongs to a workspace is left alone, so the second hook — and
 * a retried one — cannot spawn duplicates. What keeps two *concurrent* calls to one workspace per
 * user is the primary key, not the slug ladder: the workspace id is {@link personalWorkspaceId}, so
 * both calls insert the same key and one batch fails.
 *
 * A failed batch is retried (at most {@link MAX_PROVISION_ATTEMPTS} attempts) and the cause is read
 * from database state, never from the error: SQLite names a column and D1 wraps the error again, so
 * a string match could pass against the test harness and miss in production. In order:
 *
 * 1. the user now has a workspace → the other call won; return it;
 * 2. the attempted id is held by a workspace → it is one this user is not in (step 1 found none), so
 *    draw a random id rather than lock the user out, at the price of the race protection;
 * 3. the attempted slug is held → reserve another;
 * 4. none of these → not a collision; rethrow, so a failure that cannot be retried never loops.
 */
export async function provisionPersonalWorkspace(
  db: AppDatabase,
  user: { id: string; name?: string | null; email: string },
): Promise<string> {
  const existing = await firstOrganizationIdFor(db, user.id)
  if (existing) return existing

  const baseSlug = personalWorkspaceSlug(user)
  let organizationId = await personalWorkspaceId(user.id)
  let slug = await reserveSlug(db, baseSlug)

  for (let attempt = 1; ; attempt += 1) {
    const now = new Date()
    try {
      await db.batch([
        db.insert(organization).values({
          id: organizationId,
          name: personalWorkspaceName(user),
          slug,
          logo: null,
          metadata: JSON.stringify({ personal: true }),
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(member).values({
          id: newAuthId(),
          organizationId,
          userId: user.id,
          role: 'owner' satisfies OrganizationRole,
          createdAt: now,
        }),
        // The workspace's currencies, base first. `live_rate_update` is true on all of them: a fresh
        // workspace prices from the catalogue, and a household that settles at its own fixed rate
        // says so afterwards. See the docblock for why this write is in the batch rather than in a
        // repo.
        db.insert(organizationCurrencies).values(
          DEFAULT_WORKSPACE_CURRENCY_CODES.map((currencyCode) => ({
            organizationId,
            currencyCode,
            isBase: currencyCode === DEFAULT_BASE_CURRENCY_CODE,
            liveRateUpdate: true,
            addedAt: now,
          })),
        ),
        // Same batch exception as the currency rows: there is no TenantScope until this
        // workspace exists. Cron "today" reads this timezone (`docs/MONEY.md` §6.4).
        db.insert(organizationSettings).values({
          organizationId,
          timezone: DEFAULT_WORKSPACE_TIMEZONE,
          createdAt: now,
          updatedAt: now,
        }),
      ])
      return organizationId
    } catch (error) {
      // The winner re-read comes first, so a user whose last attempt lost the race still gets the
      // workspace the other call created instead of a failed sign-up.
      const winner = await firstOrganizationIdFor(db, user.id)
      if (winner) return winner

      if (attempt >= MAX_PROVISION_ATTEMPTS) throw error

      if (await organizationExists(db, eq(organization.id, organizationId))) {
        organizationId = newAuthId()
      } else if (await organizationExists(db, eq(organization.slug, slug))) {
        slug = await reserveSlug(db, baseSlug)
      } else {
        throw error
      }
    }
  }
}

async function organizationExists(
  db: AppDatabase,
  condition: SQL,
): Promise<boolean> {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(condition)
    .limit(1)
  return rows.length > 0
}

/** The workspace a returning account lands in: its oldest membership. */
export async function firstOrganizationIdFor(
  db: AppDatabase,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1)
  return rows[0]?.organizationId ?? null
}

/**
 * The caller's role inside one workspace, or `null` when they are not a member.
 *
 * This read is what makes `requireOrg` honest: it is the **fact**, where a session claim is only a
 * snapshot of it. Returned as `string | null` rather than as `OrganizationRole` on purpose — the
 * column carries a default but no `CHECK`, so validating the value is the guard's job and not this
 * function's guess.
 */
export async function membershipRoleFor(
  db: AppDatabase,
  input: { userId: string; organizationId: string },
): Promise<string | null> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, input.userId),
        eq(member.organizationId, input.organizationId),
      ),
    )
    .limit(1)
  return rows[0]?.role ?? null
}

/**
 * The workspace a session should be pinned to, provisioning the personal one first if it does not
 * exist yet.
 *
 * Answers `null` only when the user row itself is gone, in which case the caller leaves the session
 * untouched rather than inventing a workspace for an account that no longer exists.
 */
export async function resolveOrProvisionOrganization(
  db: AppDatabase,
  userId: string,
): Promise<string | null> {
  const existing = await firstOrganizationIdFor(db, userId)
  if (existing) return existing

  const rows = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1)

  const owner = rows.at(0)
  if (!owner) return null

  return provisionPersonalWorkspace(db, owner)
}
