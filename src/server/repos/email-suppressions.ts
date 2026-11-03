/**
 * Addresses that must never be mailed again, keyed by the salted recipient hash.
 *
 * **Platform data, not tenant data — the fourth documented carve-out from `docs/SPEC.md` §5.2.**
 * A bounce or complaint is a fact about a mailbox, not a workspace. Per-workspace suppression
 * would keep emailing a complained address from a second household and burn sender reputation
 * (spec A2). There is no `organization_id` and therefore no `TenantScope` to write under.
 *
 * This module exports no scoped reader: {@link isSuppressed} and {@link suppress} take a bare
 * {@link Database}. The lookup is reachable only from the notification-email queue handler. The
 * write is for the Resend webhook (a later phase) and is not called from a server function.
 */

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { EMAIL_SUPPRESSION_REASONS } from '#/lib/enums'
import { emailSuppressions } from '#/server/db/schema'

import type { EmailSuppressionReason } from '#/lib/enums'
import type { Database } from './base'

const hashSchema = z.string().trim().min(1).max(128)
const reasonSchema = z.enum(EMAIL_SUPPRESSION_REASONS)

/** Whether this hash is on the platform suppression list. */
export async function isSuppressed(
  db: Database,
  hash: string,
): Promise<boolean> {
  const parsed = hashSchema.parse(hash)
  const rows = await db
    .select({ emailHash: emailSuppressions.emailHash })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.emailHash, parsed))
    .limit(1)
  return rows.length > 0
}

/**
 * Records a bounce or complaint against a hash.
 *
 * A redelivery is an insert conflict and a no-op: the first reason to land stays. Lookup, not
 * this write, is what Phase 2 of `21-S2` installs.
 */
export async function suppress(
  db: Database,
  hash: string,
  reason: EmailSuppressionReason,
  now: Date,
): Promise<void> {
  const parsedHash = hashSchema.parse(hash)
  const parsedReason = reasonSchema.parse(reason)
  await db
    .insert(emailSuppressions)
    .values({
      emailHash: parsedHash,
      reason: parsedReason,
      createdAt: now,
    })
    .onConflictDoNothing({ target: emailSuppressions.emailHash })
}
