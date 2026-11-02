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
 * Creates or replaces the timezone. The extra `WHERE 1` is the 1:1 table's identity — the
 * tenant predicate is the real scope, and there is no second key to name.
 */
export async function setWorkspaceTimezone(
  scope: TenantScope,
  input: WorkspaceTimezoneInput,
): Promise<string> {
  const parsed = workspaceTimezoneSchema.parse(input)
  const existing = await settingsAccess.findMany(scope, { limit: 1 })
  const now = new Date()

  if (existing[0]) {
    await settingsAccess.updateWhere(scope, sql`1`, {
      timezone: parsed.timezone,
      updatedAt: now,
    })
    return parsed.timezone
  }

  await settingsAccess.insert(scope, {
    timezone: parsed.timezone,
    createdAt: now,
    updatedAt: now,
  })
  return parsed.timezone
}
