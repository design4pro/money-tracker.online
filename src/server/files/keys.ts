/**
 * The R2 key layout for the files nothing writes yet: exports, backups and the dead-letter archive.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 *
 * **The workspace is always the second segment of a tenant family**, so a sweep of one workspace is
 * one prefix list per family and a reader can refuse an address that belongs to another workspace
 * (`assertKeyInOrg`). **There is one bucket per environment**, so no key carries the environment.
 *
 * ```
 * exports/<workspace>/<job>.<zip|json>
 * backups/<workspace>/<yyyy-mm-dd>.json
 * dlq/<queue>/<message>.json                 platform-level: no workspace
 * ```
 *
 * `importFileKey` (`repos/imports.ts`) and `attachmentKey` (`repos/attachments.ts`) are shipped,
 * stay in their repositories and are not moved here. They follow the same rule, which is why
 * `orgPrefix` also names their families.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BUILDERS TAKE PLAIN STRINGS
 * ---------------------------------------------------------------------------
 *
 * The backup cron runs across workspaces, so a `TenantScope` is the wrong parameter; and the module
 * imports nothing, so it can be read, and tested, without a binding, a database or a Worker runtime.
 * The price is that every segment is checked here: one that is empty, is `.` or `..`, or contains a
 * slash or a backslash would change the shape of the address, so it is refused.
 */

/** The families whose second segment is a workspace id. */
export type WorkspaceKeyFamily =
  'imports' | 'exports' | 'attachments' | 'backups'

/** An address, or a part of one, that the layout does not allow. */
export class InvalidKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidKeyError'
  }
}

/** A calendar day, `YYYY-MM-DD`; the round trip through `Date` below refuses `2026-02-31` and `2026-13-01`. */
const DAY = /^\d{4}-\d{2}-\d{2}$/

function segment(name: string, value: string): string {
  if (
    value === '' ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new InvalidKeyError(`${name} is not a valid key segment`)
  }
  return value
}

function calendarDay(value: string): string {
  // `toISOString` throws a RangeError on an invalid Date, so test the time value first.
  const parsed = new Date(`${value}T00:00:00Z`)
  const real =
    DAY.test(value) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().startsWith(value)
  if (!real) throw new InvalidKeyError('date is not a YYYY-MM-DD calendar day')
  return value
}

/** `<family>/<workspace>/`: always ends in a separator, so one workspace id is never a prefix of another. */
export function orgPrefix(
  family: WorkspaceKeyFamily,
  organizationId: string,
): string {
  return `${family}/${segment('organizationId', organizationId)}/`
}

/**
 * Throws unless `key` is under the workspace's prefix within `family`; for a reader about to `get`
 * a stored key.
 *
 * A segment after the prefix that is exactly `.` or `..` is refused too, the same two the builders
 * refuse: R2 keys are literal today, but a key that only looks like it is under the prefix should
 * not pass if that ever changes. A dot inside a segment (`file..pdf`) is an ordinary name.
 */
export function assertKeyInOrg(
  family: WorkspaceKeyFamily,
  organizationId: string,
  key: string,
): void {
  const prefix = orgPrefix(family, organizationId)
  const underPrefix =
    key.startsWith(prefix) &&
    !key
      .slice(prefix.length)
      .split('/')
      .some((part) => part === '.' || part === '..')
  if (!underPrefix) {
    throw new InvalidKeyError(
      `key is not under the ${family} prefix of the workspace`,
    )
  }
}

export function exportKey(
  organizationId: string,
  jobId: string,
  format: 'zip' | 'json',
): string {
  return `${orgPrefix('exports', organizationId)}${segment('jobId', jobId)}.${format}`
}

export function backupKey(organizationId: string, date: string): string {
  return `${orgPrefix('backups', organizationId)}${calendarDay(date)}.json`
}

export function dlqKey(queue: string, messageId: string): string {
  return `dlq/${segment('queue', queue)}/${segment('messageId', messageId)}.json`
}
