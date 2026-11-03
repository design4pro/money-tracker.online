/**
 * Workspace settings: the civil timezone cron and due/overdue use.
 *
 * One row per workspace. Missing is a default, not an error — a workspace provisioned before
 * this table, or a fixture that only inserted `organization`, still has a well-defined "today"
 * (`Europe/Warsaw`). Writes go through {@link createTenantTableAccess}, so aiming the row at
 * another workspace is not expressible.
 */

import { sql } from 'drizzle-orm'
import { z } from 'zod'

import {
  DEFAULT_WORKSPACE_TIMEZONE,
  canonicalIanaTimeZone,
  isIanaTimeZone,
} from '#/server/calendar-day'
import { organizationSettings } from '#/server/db/schema'

import { createTenantTableAccess } from './base'

import type { TenantScope } from './base'

const settingsAccess = createTenantTableAccess(
  organizationSettings,
  'workspace settings',
)

export const workspaceTimezoneSchema = z.strictObject({
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(isIanaTimeZone, { error: 'Invalid IANA time zone' }),
})
export type WorkspaceTimezoneInput = z.input<typeof workspaceTimezoneSchema>

/** The workspace's civil timezone, or Warsaw when no settings row exists yet. */
export async function getWorkspaceTimezone(
  scope: TenantScope,
): Promise<string> {
  const rows = await settingsAccess.findMany(scope, { limit: 1 })
  return rows[0]?.timezone ?? DEFAULT_WORKSPACE_TIMEZONE
}

/**
 * Creates or replaces the timezone. One insert-on-conflict, then an update if
 * the row already existed — never a read that decides the write, which two
 * concurrent first saves would both see as empty. The extra `WHERE 1` is the
 * 1:1 table's identity — the tenant predicate is the real scope, and there is
 * no second key to name. The stored value is the Intl canonical id.
 */
export async function setWorkspaceTimezone(
  scope: TenantScope,
  input: WorkspaceTimezoneInput,
): Promise<string> {
  const parsed = workspaceTimezoneSchema.parse(input)
  const timezone = canonicalIanaTimeZone(parsed.timezone)
  if (timezone === null) {
    throw new Error('Invalid IANA time zone')
  }
  const now = new Date()

  const inserted = await settingsAccess.insertOnConflictDoNothing(
    scope,
    {
      timezone,
      createdAt: now,
      updatedAt: now,
    },
    [organizationSettings.organizationId],
  )
  if (inserted !== null) return inserted.timezone

  await settingsAccess.updateWhere(scope, sql`1`, {
    timezone,
    updatedAt: now,
  })
  return timezone
}
