import { Link } from '@tanstack/react-router'

import { buttonVariants } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'
import { QUOTA_METRIC_LABEL_KEYS } from '#/lib/plans'

import { DashboardLink } from './dashboard-link'
import { ErrorPanel } from './error-panel'
import { FailureReference, hasOpaqueIdShape } from './failure-reference'

import type { FailureEnvelope, FailureKind } from '#/lib/failure-envelope'
import type { ReactNode } from 'react'

/**
 * The way out a panel offers. Four, because four things can be done about a failure: try again,
 * change the plan, accept that the plan does not include it, or report it.
 */
export type Recovery = 'retryable' | 'quota' | 'feature_locked' | 'internal'

/**
 * What to *offer* for each kind of failure. Total over {@link FailureKind}: a kind added to the
 * envelope without a recovery here does not compile, so the panel can never meet one it has no
 * answer for.
 *
 * This is presentation, not classification: `kind` is `05-S1`'s, and the panel only decides what
 * to put beside the sentence. `not_found` and `forbidden` share `internal` on purpose, so the
 * screen never offers a different way out for a missing row and a foreign one. `unauthenticated`
 * is `internal` as well: the redirect to sign-in belongs to the route guard.
 */
export const RECOVERY_OF: Readonly<Record<FailureKind, Recovery>> = {
  quota: 'quota',
  feature_locked: 'feature_locked',
  validation: 'retryable',
  conflict: 'retryable',
  rate_limited: 'retryable',
  rate_unavailable: 'retryable',
  upstream: 'retryable',
  unauthenticated: 'internal',
  forbidden: 'internal',
  not_found: 'internal',
  internal: 'internal',
}

/** The billing link is painted as a button for the same reasons as `DashboardLink`. */
const PRIMARY_LINK = cn(
  buttonVariants({ variant: 'primary' }),
  'no-underline hover:bg-accent-hover hover:shadow-elevated active:translate-y-px',
)

export interface FailurePanelProps {
  /** What `readFailure(error)` returned. Only `kind` and `message` are read. */
  failure: FailureEnvelope
  /**
   * `after-action` is the result of something the reader just did: an alert, and focus moves to
   * its heading. `in-place` is a block that failed to load: a labelled region that never moves
   * focus.
   */
  placement: 'after-action' | 'in-place'
  onRetry?: () => void
  isRetrying?: boolean
  /**
   * An event id or a request id, for the `internal` recovery only. Anything that is not shaped
   * like one is dropped (`FailureReference`).
   */
  reference?: string
  /**
   * Where the `internal` recovery sends the reader back to. Passed only by a caller inside the
   * shell, so the panel never decides by itself whether anyone is signed in.
   */
  homeHref?: string
  /** Wording for the `retryable` recovery, which may be the call site's. **Catalogue copy.** */
  title?: ReactNode
  body?: ReactNode
  className?: string
}

/**
 * A failure panel that offers the way out the kind of failure calls for.
 *
 * It reads the shipped {@link FailureEnvelope} and nothing a thrown value *says*: the sentence is
 * the envelope's own catalogue key, so two failures of one kind read the same. There is no
 * `detail` prop and no `<details>`, no shape renders a plan name or an amount (the envelope
 * carries neither), and `title` and `body` are catalogue copy by convention - the type cannot say
 * so, and a test cannot prove it.
 *
 * | Recovery         | Rendered                                                                |
 * | ---------------- | ----------------------------------------------------------------------- |
 * | `retryable`      | Retry, beside the form and never instead of it, so input survives.      |
 * | `quota`          | A link to billing, the sentence and "Limit reached: {metric}."          |
 * | `feature_locked` | A link to billing and the sentence; it names nothing else.              |
 * | `internal`       | The sentence, Retry if given, a link home if given, a reference if given |
 *
 * The record decides which extras appear, not whether Retry is meaningful: `retryable` and
 * `internal` show Retry when the caller passes `onRetry`.
 *
 * Focus moves to the heading on mount only, and an alert is announced on insertion only. A caller
 * that retries should key the panel per attempt (`key={attempt}`), so a repeat failure remounts it
 * and is announced and focused again.
 *
 * `quota` and `feature_locked` use the `warning` tone because they are not faults. The links do
 * not decide anything: whether the workspace is over a limit was decided on the server.
 */
export function FailurePanel({
  failure,
  placement,
  onRetry,
  isRetrying,
  reference,
  homeHref,
  title,
  body,
  className,
}: FailurePanelProps) {
  const t = useTranslate()
  const sentence = t(failure.message.key)
  const isAfterAction = placement === 'after-action'
  const frame = {
    mode: isAfterAction ? 'alert' : 'region',
    focusHeading: isAfterAction,
    className,
  } as const

  switch (RECOVERY_OF[failure.kind]) {
    case 'quota': {
      const metric = failure.message.params?.metric
      return (
        <ErrorPanel
          {...frame}
          tone="warning"
          title={t('failure.quota.title')}
          // Two translated strings in one paragraph, never one concatenated message.
          body={
            <>
              {sentence}
              {metric
                ? ` ${t('failure.quota.metric', { metric: t(QUOTA_METRIC_LABEL_KEYS[metric]) })}`
                : null}
            </>
          }
          actions={<BillingLink />}
        />
      )
    }
    case 'feature_locked':
      return (
        <ErrorPanel
          {...frame}
          tone="warning"
          title={t('failure.featureLocked.title')}
          body={sentence}
          actions={<BillingLink />}
        />
      )
    case 'retryable':
      return (
        <ErrorPanel
          {...frame}
          title={title ?? t('empty.error.title')}
          body={body ?? sentence}
          onRetry={onRetry}
          isRetrying={isRetrying}
        />
      )
    case 'internal':
      return (
        <ErrorPanel
          {...frame}
          title={t('empty.error.title')}
          body={sentence}
          onRetry={onRetry}
          isRetrying={isRetrying}
          // `ErrorPanel` renders an action row for any truthy slot, so an empty fragment would
          // leave a blank gap under the sentence.
          actions={
            homeHref || hasOpaqueIdShape(reference) ? (
              <>
                {homeHref ? <DashboardLink to={homeHref} /> : null}
                <FailureReference reference={reference} />
              </>
            ) : undefined
          }
        />
      )
  }
}

function BillingLink() {
  const t = useTranslate()
  return (
    <Link to="/settings/billing" className={PRIMARY_LINK}>
      {t('billing.title')}
    </Link>
  )
}
