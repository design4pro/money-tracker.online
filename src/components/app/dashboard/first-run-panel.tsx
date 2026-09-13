import { useId } from 'react'

import { Link } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import type { MessageKey } from '#/lib/i18n'

/**
 * What a brand-new workspace sees instead of five empty panels.
 *
 * ## It is a designed screen, not a fallback
 *
 * A dashboard whose every widget says "nothing yet" reads as broken, and it is the very first
 * thing a new person sees. So the panels are replaced - not decorated - by an ordered list of the
 * three things that make the numbers start working, in the order they have to happen.
 *
 * ## A ruled section, not a brand card
 *
 * It used to be a `brand-soft` card holding three white tiles. The wash spent the page's one
 * violet on a decoration, and three equal tiles are the scaffold the form refuses. It is now a
 * heading over a body on a rule, and each step is a line of the book under its own rule with its
 * number at the start and its link at the end; the violet goes on the links, which is where it is
 * allowed.
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
  readonly href?: string
  /** The label for that link. Required exactly when `href` is present. */
  readonly actionKey?: MessageKey
}

export const FIRST_RUN_STEPS: ReadonlyArray<FirstRunStep> = [
  {
    id: 'account',
    titleKey: 'dashboard.firstRun.step.account.title',
    bodyKey: 'dashboard.firstRun.step.account.body',
    href: '/accounts',
    actionKey: 'accounts.create',
  },
  {
    id: 'transaction',
    titleKey: 'dashboard.firstRun.step.transaction.title',
    bodyKey: 'dashboard.firstRun.step.transaction.body',
    href: '/transactions',
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
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className="border-t border-border-panel pt-4"
    >
      <div className="max-w-prose">
        <h2 id={headingId} className="text-subtitle font-bold text-ink">
          {t('dashboard.firstRun.title')}
        </h2>
        <p className="mt-1 text-body text-ink-2">
          {t('dashboard.firstRun.body')}
        </p>
      </div>

      <ol
        aria-label={t('dashboard.firstRun.steps.label')}
        className="mt-4 list-none border-b border-border-subtle"
      >
        {FIRST_RUN_STEPS.map((step, index) => (
          <li
            key={step.id}
            className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 gap-y-1 border-t border-border-subtle py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-baseline"
          >
            {/* The number sits beside its step on the same line, as a `dt` sits beside its
                figure - never above the heading. */}
            <p className="tabular text-micro tracking-label uppercase text-ink-2">
              {index + 1}
            </p>
            <div className="min-w-0">
              <h3 className="text-subtitle font-bold text-ink">
                {t(step.titleKey)}
              </h3>
              <p className="text-caption text-ink-2">{t(step.bodyKey)}</p>
            </div>
            {step.href === undefined || step.actionKey === undefined ? null : (
              <p className="col-start-2 sm:col-start-3">
                <Link href={step.href} size="widget">
                  {t(step.actionKey)}
                </Link>
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * The line a workspace sees once it has accounts and not one transaction against them.
 *
 * `FirstRunPanel` covers the workspace with nothing in it; this is the step after, when the book
 * has been opened and nothing has been written. One ruled line, the sentence at the start and the
 * link at the end, going where the header's "New transaction" goes - the same action said in the
 * keeper's own words rather than a second stamp on a page that already has one.
 */
export function FirstEntryPrompt() {
  const t = useTranslate()

  return (
    <p className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-y border-border-subtle py-3 text-body text-ink">
      <span>{t('dashboard.firstEntry.lead')}</span>
      <Link href="/transactions/new" size="widget" className="text-body">
        {t('dashboard.firstEntry.action')}
      </Link>
    </p>
  )
}
