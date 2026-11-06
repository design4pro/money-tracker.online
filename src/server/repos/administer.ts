/**
 * The shared-workspace administer gate.
 *
 * Destructive writes need `owner | admin` — **but only in a shared workspace**. A solo workspace
 * has one member and that member is its owner, so a role gate there can only ever produce a bug
 * report. The member count is read live rather than taken from the session, for the same reason
 * `requireOrg()` re-reads the role: a claim minted before somebody was invited is a claim about a
 * workspace that no longer exists.
 *
 * Which writes call this stays decided per repository. Reads stay ungated. This is not
 * {@link import('./scope').assertRole}: that sibling has no solo-workspace exception and must not
 * be merged with this function.
 */

import { count } from 'drizzle-orm'

import { member } from '#/server/db/auth-schema'

import { tenantFilter } from './base'
import { ForbiddenError } from './errors'

import type { TenantScope } from './base'

/**
 * Refuses a non-owner, non-admin caller once the workspace has a second member.
 *
 * The `owner`/`admin` short-circuit returns before any query. Any other role triggers a live
 * count of `member` rows composed through {@link tenantFilter}; a count above one throws
 * {@link ForbiddenError} with `['owner', 'admin']`.
 */
export async function assertMayAdminister(
  scope: TenantScope,
  action: string,
): Promise<void> {
  if (scope.ctx.role === 'owner' || scope.ctx.role === 'admin') {
    return
  }
  // `member` is an auth table rather than a finance one, but it carries the same discriminator and
  // the same rule applies to it: the predicate is composed by the base, not spelled out here.
  const rows = await scope.db
    .select({ value: count() })
    .from(member)
    .where(tenantFilter(scope, member))
  if ((rows.at(0)?.value ?? 0) > 1) {
    throw new ForbiddenError(action, ['owner', 'admin'])
  }
}
