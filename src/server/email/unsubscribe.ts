/**
 * What an unsubscribe link does: read it for the confirmation page, and apply it.
 *
 * Both unsubscribe routes (`/unsubscribe` and the RFC 8058 one-click `/api/unsubscribe`) go
 * through here, so there is one answer to *"is this link good"* and one write.
 *
 * ## A link is good only while its person is still in its workspace
 *
 * {@link verifyUnsubscribeToken} proves the token; `memberScopeFor` proves the membership and
 * builds the scope every later read and write runs under. A token for workspace B therefore cannot
 * reach workspace A's rows, including for a person who belongs to both: the scope comes from the
 * token's `o`, and every preference statement carries it.
 *
 * ## The write changes one field and nothing else
 *
 * `upsertPref` replaces the whole `{ inApp, email, digest }` triple, so the current channels are
 * resolved first (stored row, else the kind's defaults) and written back with only the one field
 * turned off. `inApp` is never touched. A kind that is already off is not written at all, which is
 * what makes a second application change nothing, not even `updated_at`.
 */

import { NOTIFICATION_KIND_IDS } from '#/lib/enums'
import { NOTIFICATION_KINDS } from '#/server/notify/kinds'
import { memberScopeFor, workspaceName } from '#/server/repos/members'
import {
  listPrefsFor,
  resolvePrefs,
  upsertPref,
} from '#/server/repos/notifications'

import { verifyUnsubscribeToken } from './unsubscribe-token'

import type { NotificationKind } from '#/lib/enums'
import type { Database, TenantScope } from '#/server/repos/base'
import type { UnsubscribeKeys, UnsubscribeSubject } from './unsubscribe-token'

/**
 * A link that works, with what the page needs to name, or one answer for every link that does
 * not. No reason is carried: the invalid state never says which check failed.
 */
export type UnsubscribeOutcome =
  | {
      readonly ok: true
      readonly subject: UnsubscribeSubject
      readonly workspaceName: string
    }
  | { readonly ok: false }

const INVALID: UnsubscribeOutcome = Object.freeze({ ok: false })

/** The kinds a subject reaches: itself, or every digestible kind for the daily summary. */
function kindsOf(subject: UnsubscribeSubject): ReadonlyArray<NotificationKind> {
  if (subject !== 'digest') return [subject]
  return NOTIFICATION_KIND_IDS.filter(
    (kind) => NOTIFICATION_KINDS[kind].digestible,
  )
}

async function resolve(
  db: Database,
  keys: UnsubscribeKeys | null,
  token: string,
  now: Date,
): Promise<{ scope: TenantScope; subject: UnsubscribeSubject } | null> {
  // No signing key configured: nothing can be verified, so every link is invalid. The route logs
  // that loudly; here it is simply not a crash.
  if (!keys) return null
  const claims = await verifyUnsubscribeToken(token, keys, now)
  if (!claims) return null
  const scope = await memberScopeFor(db, claims.organizationId, claims.userId)
  if (!scope) return null
  return { scope, subject: claims.subject }
}

/**
 * What the link would stop, for the confirmation page. **Never writes**: mail scanners prefetch
 * links, and a `GET` that unsubscribed would turn every security gateway into an unsubscribe.
 */
export async function readUnsubscribe(
  db: Database,
  keys: UnsubscribeKeys | null,
  token: string,
  now: Date,
): Promise<UnsubscribeOutcome> {
  const resolved = await resolve(db, keys, token, now)
  if (!resolved) return INVALID
  return {
    ok: true,
    subject: resolved.subject,
    workspaceName: await workspaceName(resolved.scope),
  }
}

/**
 * Applies the link: a kind turns that kind's email off, `digest` turns the daily summary off for
 * every digestible kind. Idempotent.
 */
export async function applyUnsubscribe(
  db: Database,
  keys: UnsubscribeKeys | null,
  token: string,
  now: Date,
): Promise<UnsubscribeOutcome> {
  const resolved = await resolve(db, keys, token, now)
  if (!resolved) return INVALID
  const { scope, subject } = resolved

  const field = subject === 'digest' ? 'digest' : 'email'
  const stored = await listPrefsFor(scope, scope.ctx.userId)
  for (const kind of kindsOf(subject)) {
    const current = resolvePrefs(
      stored.get(kind),
      NOTIFICATION_KINDS[kind].defaults,
    )
    if (!current[field]) continue
    await upsertPref(scope, { kind, ...current, [field]: false }, now)
  }

  return { ok: true, subject, workspaceName: await workspaceName(scope) }
}
