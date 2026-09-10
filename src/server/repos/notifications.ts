/**
 * The notification store: one person's occasions, in one workspace, and what they want to hear.
 *
 * ---------------------------------------------------------------------------
 * ONE WRITER
 * ---------------------------------------------------------------------------
 *
 * {@link insertNotification} is exported for exactly one caller — `#/server/notify/dispatch` — and
 * for nobody else. Preference resolution, the membership check and the dedupe decision all live
 * there, and a second caller reaching this function directly would bypass all three: a row addressed
 * to a non-member, or a row for a kind the person switched off. The narrow export is the enforcement
 * a comment cannot be; `__tests__/tenant-isolation.test.ts` is the proof that scoping holds either
 * way.
 *
 * ---------------------------------------------------------------------------
 * WHY A UNIQUE VIOLATION IS A RESULT AND NOT AN ERROR
 * ---------------------------------------------------------------------------
 *
 * The budget cron re-evaluates every threshold every fifteen minutes and the recurring cron runs
 * hourly. Both write their dedupe marker **after** a successful dispatch, on purpose, so a
 * transient failure retries rather than being swallowed — which means a retry legitimately
 * re-offers a row that already landed. {@link insertNotification} therefore reports `'deduped'`
 * instead of throwing.
 *
 * It decides that from `ON CONFLICT DO NOTHING … RETURNING`, never from inspecting the error a
 * failed insert would have raised. SQLite's message names the *columns*
 * (`UNIQUE constraint failed: notifications.organization_id, …`) and D1 wraps it again, so there is
 * no stable string to match; and a read-then-write pre-check would let two cron ticks both decide
 * the row is absent. One statement has neither problem.
 *
 * ---------------------------------------------------------------------------
 * A MISSING PREFERENCE ROW IS NOT A MISSING PREFERENCE
 * ---------------------------------------------------------------------------
 *
 * It means "use the kind's defaults". Nothing seeds rows: writing three booleans per kind per
 * member would spell today's defaults out longhand and freeze them into every existing household
 * the day one is revised. {@link resolvePrefs} is what makes that invisible to a caller.
 */

import { eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { NOTIFICATION_KIND_IDS } from '#/lib/enums'
import { newId } from '#/server/db/ids'
import { notificationPrefs, notifications } from '#/server/db/schema'

import { allOf, createTenantRepository, createTenantTableAccess } from './base'
import { DEFAULT_PAGE_SIZE, clampPageSize } from './pagination'

import type { NotificationKind } from '#/lib/enums'
import type { NotificationPrefRow, NotificationRow } from '#/server/db/schema'
import type { ChannelDefaults } from '#/server/notify/kinds'
import type { TenantScope } from './base'
import type { CursorPage } from './pagination'

/** A repository rather than plain table access: {@link pageForReader} needs its keyset `page`. */
const notificationRepo = createTenantRepository(notifications, 'notification')

const prefRepo = createTenantTableAccess(
  notificationPrefs,
  'notification preference',
)

/* -------------------------------------------------------------------------- */
/* Input schemas — parsed here a second time, per docs/SPEC.md §6.1           */
/* -------------------------------------------------------------------------- */

const userId = z.string().trim().min(1).max(64)
const kindSchema = z.enum(NOTIFICATION_KIND_IDS)

export const notificationPrefSchema = z.strictObject({
  kind: kindSchema,
  inApp: z.boolean(),
  email: z.boolean(),
  digest: z.boolean(),
})
export type NotificationPrefInput = z.infer<typeof notificationPrefSchema>

/**
 * The ids to mark read.
 *
 * Capped at 100 because this is a list operation on a screen, not a bulk tool: an unbounded array
 * is an unbounded `IN (…)`, and D1 has an opinion about that which arrives as a 500.
 */
export const markReadSchema = z.strictObject({
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(100),
})

const insertSchema = z.strictObject({
  userId,
  kind: kindSchema,
  payloadJson: z.string(),
  dedupeKey: z.string().trim().min(1).max(200),
})
export type InsertNotificationInput = z.infer<typeof insertSchema>

/* -------------------------------------------------------------------------- */
/* Writes — the dispatcher's alone                                            */
/* -------------------------------------------------------------------------- */

/** `'written'` on a new row; `'deduped'` when this workspace already told this person this. */
export type InsertOutcome = 'written' | 'deduped'

/**
 * Writes one notification, or reports that this occasion already reached this person.
 *
 * **`#/server/notify/dispatch` is the only intended caller.** See the module docblock.
 */
export async function insertNotification(
  scope: TenantScope,
  input: InsertNotificationInput,
  now: Date,
): Promise<InsertOutcome> {
  const parsed = insertSchema.parse(input)
  const row = await notificationRepo.insertOnConflictDoNothing(
    scope,
    {
      id: newId(),
      userId: parsed.userId,
      kind: parsed.kind,
      payloadJson: parsed.payloadJson,
      dedupeKey: parsed.dedupeKey,
      readAt: null,
      createdAt: now,
    },
    // The columns of `notifications_organization_id_user_id_dedupe_key_unique`.
    [
      notifications.organizationId,
      notifications.userId,
      notifications.dedupeKey,
    ],
  )

  return row === null ? 'deduped' : 'written'
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One person's notifications, newest first, keyset-paginated.
 *
 * Scoped to `scope.ctx.userId` and not to an arbitrary id: two members of a household each read
 * their own, and "whose notifications" is not a parameter a caller gets to choose.
 */
export async function pageForReader(
  scope: TenantScope,
  options: { readonly cursor?: string | null; readonly limit?: number } = {},
): Promise<CursorPage<NotificationRow>> {
  const limit = clampPageSize(options.limit ?? DEFAULT_PAGE_SIZE)
  return notificationRepo.page(scope, {
    where: eq(notifications.userId, scope.ctx.userId),
    limit,
    cursor: options.cursor ?? null,
  })
}

/** How many of this reader's notifications are unread. The number in the badge. */
export async function countUnread(scope: TenantScope): Promise<number> {
  return notificationRepo.count(
    scope,
    allOf(
      eq(notifications.userId, scope.ctx.userId),
      isNull(notifications.readAt),
    ),
  )
}

/**
 * Marks the reader's own notifications read. Returns how many actually changed.
 *
 * Already-read rows are excluded rather than re-stamped: `read_at` records when somebody first saw
 * it, and a second mark-all-read should not rewrite that.
 */
export async function markRead(
  scope: TenantScope,
  input: z.input<typeof markReadSchema>,
  now: Date,
): Promise<number> {
  const { ids } = markReadSchema.parse(input)
  const rows = await notificationRepo.updateWhere(
    scope,
    allOf(
      eq(notifications.userId, scope.ctx.userId),
      inArray(notifications.id, [...ids]),
      isNull(notifications.readAt),
    ),
    { readAt: now },
  )
  return rows.length
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every stored preference row for one person, as a map keyed by kind.
 *
 * Read once per workspace per cron tick rather than once per recipient-event: a five-member
 * household with twenty crossings is a hundred lookups otherwise, inside a tick that also has every
 * other workspace to sweep.
 */
export async function listPrefsFor(
  scope: TenantScope,
  forUserId: string,
): Promise<Map<NotificationKind, NotificationPrefRow>> {
  const id = userId.parse(forUserId)
  const rows = await prefRepo.findMany(scope, {
    where: eq(notificationPrefs.userId, id),
  })
  return new Map(rows.map((row) => [row.kind as NotificationKind, row]))
}

/** The stored row's channels if there is one, else the kind's defaults. */
export function resolvePrefs(
  stored: NotificationPrefRow | undefined,
  defaults: ChannelDefaults,
): ChannelDefaults {
  if (!stored) return defaults
  return { inApp: stored.inApp, email: stored.email, digest: stored.digest }
}

/** Creates or replaces the reader's own preference for one kind. */
export async function upsertPref(
  scope: TenantScope,
  input: z.input<typeof notificationPrefSchema>,
  now: Date,
): Promise<NotificationPrefRow> {
  const parsed = notificationPrefSchema.parse(input)
  const existing = await prefRepo.findOne(
    scope,
    allOf(
      eq(notificationPrefs.userId, scope.ctx.userId),
      eq(notificationPrefs.kind, parsed.kind),
    ),
  )

  if (existing) {
    const rows = await prefRepo.updateWhere(
      scope,
      eq(notificationPrefs.id, existing.id),
      {
        inApp: parsed.inApp,
        email: parsed.email,
        digest: parsed.digest,
        updatedAt: now,
      },
    )
    return rows[0]
  }

  return prefRepo.insert(scope, {
    id: newId(),
    userId: scope.ctx.userId,
    kind: parsed.kind,
    inApp: parsed.inApp,
    email: parsed.email,
    digest: parsed.digest,
    createdAt: now,
    updatedAt: now,
  })
}
