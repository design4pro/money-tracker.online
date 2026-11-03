/**
 * The locale a notification email is written in.
 *
 * `negotiate()`'s chain is user → workspace → `Accept-Language` → `en`. A queue handler has no
 * request, so `acceptLanguage` is always `null` here. The stored-locale seam returns `null` until
 * plan 23 (`user_preferences.locale`) or plan 02 (`organization_settings.locale`) lands, which
 * means notification mail is English until then (spec A1). Wiring a real stored value is then one
 * function on this seam.
 */

import { negotiate } from '#/lib/i18n'

import type { Locale } from '#/lib/i18n'
import type { TenantScope } from '#/server/repos/base'

/** Where a stored locale would be read from, once those tables exist. */
export interface StoredLocaleSeam {
  readonly userLocale: (
    scope: TenantScope,
    userId: string,
  ) => Promise<string | null>
  readonly workspaceLocale: (scope: TenantScope) => Promise<string | null>
}

const unset: StoredLocaleSeam = {
  userLocale: async () => null,
  workspaceLocale: async () => null,
}

export async function resolveRecipientLocale(
  scope: TenantScope,
  userId: string,
  stored: StoredLocaleSeam = unset,
): Promise<Locale> {
  const [user, workspace] = await Promise.all([
    stored.userLocale(scope, userId),
    stored.workspaceLocale(scope),
  ])
  return negotiate({ user, workspace, acceptLanguage: null })
}
