import { Archive, EyeOff } from 'lucide-react'

import { Badge } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { accountCategoryFacts, isAccountCategory } from './categories'

/**
 * The three labels an account can wear, all of them words.
 *
 * A badge in this system is text (`src/components/ui/badge.tsx`), which is why the category is a
 * badge and not a colour swatch: "Credit card" survives greyscale, forced colours and a reader
 * who cannot separate the amber wash from the sheet behind it. The archived and excluded badges
 * carry an icon as well, so the two states that change what a row *means* are legible from three
 * channels rather than one.
 */

export interface AccountCategoryBadgeProps {
  /** The raw `accounts.category` column. Unknown values render nothing rather than a code. */
  category: string
  size?: 'sm' | 'md'
}

export function AccountCategoryBadge({
  category,
  size = 'sm',
}: AccountCategoryBadgeProps) {
  const t = useTranslate()
  if (!isAccountCategory(category)) {
    return null
  }
  return (
    <Badge tone="neutral" size={size}>
      {t(accountCategoryFacts(category).labelKey)}
    </Badge>
  )
}

export interface AccountStateBadgesProps {
  /** `accounts.status` — `active` renders nothing, because normal needs no label. */
  status: string
  excludeFromStats: boolean
  size?: 'sm' | 'md'
}

/** Archived and out-of-reports, in that order. Both absent for an ordinary account. */
export function AccountStateBadges({
  status,
  excludeFromStats,
  size = 'sm',
}: AccountStateBadgesProps) {
  const t = useTranslate()

  return (
    <>
      {status === 'archived' ? (
        <Badge tone="warning" size={size} icon={<Archive />}>
          {t('common.archived')}
        </Badge>
      ) : null}
      {excludeFromStats ? (
        <Badge tone="info" size={size} icon={<EyeOff />}>
          {t('accounts.status.excluded')}
        </Badge>
      ) : null}
    </>
  )
}
