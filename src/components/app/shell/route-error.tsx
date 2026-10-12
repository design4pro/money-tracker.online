import { RotateCcw, TriangleAlert } from 'lucide-react'
import { useId, useRef } from 'react'

import { Button } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'

import { DashboardLink } from './dashboard-link'
import { FailureReference, hasOpaqueIdShape } from './failure-reference'
import { useFocusHeading } from './use-focus-heading'
import { useIsAfterInitialRender } from './use-is-after-initial-render'

export interface RouteErrorProps {
  /**
   * Retries the failed load. TanStack hands the boundary a `reset`; wire it here so the reader has
   * a way out that is not the browser's reload button.
   */
  onRetry?: () => void
  /**
   * An opaque identifier for the failure — a Sentry event id, a request id. **Never a message and
   * never a stack.** A diagnostic in the browser is a diagnostic in an attacker's browser too; a
   * reference is what lets a support conversation find the real one in the logs.
   */
  reference?: string
  /**
   * Where "Back to the dashboard" goes. Passed only from inside the signed-in shell: outside it a
   * reader sent to the dashboard is bounced through sign-in, and a guard that just failed would
   * loop. Without it there is no link.
   */
  homeHref?: string
  className?: string
}

/**
 * The designed failure state for a route.
 *
 * It is rendered *inside* the shell, which is the point of the component: navigation, the workspace
 * switcher and the sign-out control all survive a route that threw, so a reader whose reports page
 * failed can still reach their accounts. A boundary mounted above the shell replaces the whole
 * product with an apology.
 *
 * Nothing about the underlying error reaches the screen. The heading and the body are catalogue
 * copy in the reader's language, and the only variable is the reference — see `reference`.
 *
 * The glyph is `aria-hidden` and the message never depends on it: the state is carried by the
 * heading and the sentence, with the icon and the warning colour as reinforcement, never as the
 * signal.
 *
 * ## The page's own heading, and a region
 *
 * It replaces the failing route's content, and with it that route's `h1`, so it renders the `h1`.
 * It is the page's content rather than a response to something the reader just did, so it is a
 * labelled region and not an alert: an alert on initial render is announced before the person has
 * any context for it.
 *
 * ## Focus
 *
 * After a client navigation the content the reader asked for is gone, so focus moves to the
 * heading. On the document's own first render it does not: the browser has already placed focus
 * on the document and the skip link has to stay the first tab stop (`useIsAfterInitialRender`).
 * Giving focus back when the panel goes away holding it applies either way (`useFocusHeading`).
 *
 * ## The tab title
 *
 * It never writes `document.title`. The router runs `head()` for the failed match too, so the tab
 * already carries the failed route's own title; an imperative write would compete with the
 * `<title>` the head renders and would outlive a successful Retry on the same route.
 */
export function RouteError({
  onRetry,
  reference,
  homeHref,
  className,
}: RouteErrorProps) {
  const t = useTranslate()
  const headingId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const moveFocus = useIsAfterInitialRender()
  useFocusHeading(true, panelRef, headingRef, moveFocus)

  return (
    <section
      ref={panelRef}
      aria-labelledby={headingId}
      className={cn(
        'mx-auto flex max-w-lg flex-col items-center gap-4 rounded-xl border border-border-subtle bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full bg-warning-soft text-warning"
      >
        <TriangleAlert className="size-6" />
      </span>

      <div>
        <h1
          ref={headingRef}
          id={headingId}
          tabIndex={moveFocus ? -1 : undefined}
          className="text-title text-ink outline-none"
        >
          {t('empty.error.title')}
        </h1>
        <p className="mt-2 text-body text-ink-2">{t('app.shell.error.body')}</p>
      </div>

      {onRetry || homeHref || hasOpaqueIdShape(reference) ? (
        <div className="flex flex-wrap justify-center gap-3">
          {onRetry ? (
            <Button
              variant="primary"
              onPress={onRetry}
              icon={<RotateCcw className="size-4" />}
            >
              {t('action.retry')}
            </Button>
          ) : null}
          {homeHref ? <DashboardLink to={homeHref} /> : null}
          <FailureReference reference={reference} className="justify-center" />
        </div>
      ) : null}
    </section>
  )
}
