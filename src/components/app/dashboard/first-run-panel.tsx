import { Card } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import { WidgetLink } from './widget-link'

import type { MessageKey } from '#/lib/i18n'
import type { WidgetLinkProps } from './widget-link'

/**
 * What a brand-new workspace sees instead of five empty panels.
 *
 * ## It is a designed screen, not a fallback
 *
 * A dashboard whose every widget says "nothing yet" reads as broken, and it is the very first
 * thing a new person sees. So the panels are replaced — not decorated — by an ordered list of the
 * three things that make the numbers start working, in the order they have to happen.
 *
 * ## A step with nowhere to go has no button
 *
 * The steps come from {@link FIRST_RUN_STEPS}, and a step whose destination has not shipped yet
 * renders as text. A disabled button with no explanation is worse than no button, and a link to a
 * route that does not exist is worse than both. Adding a step later is one entry in that array.
 *
 * ## An ordered list, and the order is the meaning
 *
 * `<ol>` rather than three cards: the sequence is the content, and a screen reader announcing
 * "list, 3 items" with numbers is how that sequence survives.
 */
export interface FirstRunStep {
  readonly id: string
  readonly titleKey: MessageKey
  readonly bodyKey: MessageKey
  /** The route the step's link goes to. Omitted while the destination does not exist. */
  readonly to?: WidgetLinkProps['to']
  /** The label for that link. Required exactly when `to` is present. */
  readonly actionKey?: MessageKey
}

export const FIRST_RUN_STEPS: ReadonlyArray<FirstRunStep> = [
  {
    id: 'account',
    titleKey: 'dashboard.firstRun.step.account.title',
    bodyKey: 'dashboard.firstRun.step.account.body',
    to: '/accounts',
    actionKey: 'accounts.create',
  },
  {
    id: 'transaction',
    titleKey: 'dashboard.firstRun.step.transaction.title',
    bodyKey: 'dashboard.firstRun.step.transaction.body',
    to: '/transactions',
    actionKey: 'transactions.create',
  },
  {
    id: 'review',
    titleKey: 'dashboard.firstRun.step.review.title',
    bodyKey: 'dashboard.firstRun.step.review.body',
  },
]

export function FirstRunPanel() {
  const t = useTranslate()

  return (
    <Card variant="brand" padding="lg" className="flex flex-col gap-5">
      <div className="max-w-prose">
        <h2 className="text-subtitle font-semibold text-ink">
          {t('dashboard.firstRun.title')}
        </h2>
        <p className="mt-1 text-body text-ink-2">
          {t('dashboard.firstRun.body')}
        </p>
      </div>

      <ol
        aria-label={t('dashboard.firstRun.steps.label')}
        className="grid list-none gap-3 sm:grid-cols-3"
      >
        {FIRST_RUN_STEPS.map((step, index) => (
          <li
            key={step.id}
            className="flex flex-col gap-2 rounded-lg bg-surface px-4 py-3"
          >
            <p className="text-micro tracking-label uppercase text-ink-2">
              {index + 1}
            </p>
            <h3 className="text-label font-semibold text-ink">
              {t(step.titleKey)}
            </h3>
            <p className="flex-1 text-caption text-ink-2">{t(step.bodyKey)}</p>
            {step.to === undefined || step.actionKey === undefined ? null : (
              <p>
                <WidgetLink to={step.to}>{t(step.actionKey)}</WidgetLink>
              </p>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}
