import { useTranslate } from '#/lib/i18n'

import { ButtonLink } from './button-link'

export interface DashboardLinkProps {
  /**
   * Where "back" is. Passed only by a caller that knows the reader is signed in: a signed-out
   * reader sent to the dashboard is bounced through sign-in, and a guard that just failed would
   * loop.
   */
  to: string
}

/** "Back to the dashboard", the way out a failure offers inside the signed-in shell. */
export function DashboardLink({ to }: DashboardLinkProps) {
  const t = useTranslate()
  return (
    <ButtonLink to={to} variant="secondary">
      {t('failure.dashboard.action')}
    </ButtonLink>
  )
}
