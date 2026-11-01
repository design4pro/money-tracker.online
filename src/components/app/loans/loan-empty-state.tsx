import { Landmark } from 'lucide-react'

import { EmptyState } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The screen a workspace with no liabilities meets.
 *
 * There is no create form in this stage: the empty state explains what a liability is over an
 * account balance and does not offer a button that would open a missing dialog.
 */

export function LoanEmptyState() {
  const t = useTranslate()
  return (
    <EmptyState
      icon={<Landmark />}
      title={t('loans.empty.title')}
      description={t('loans.empty.body')}
      headingLevel={2}
    />
  )
}
