import { RotateCcw, TriangleAlert } from 'lucide-react'

import { Button } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'

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
 */
export function RouteError({ onRetry, reference, className }: RouteErrorProps) {
  const t = useTranslate()

  return (
    <div
      role="alert"
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
        <h2 className="text-title text-ink">{t('empty.error.title')}</h2>
        <p className="mt-2 text-body text-ink-2">{t('app.shell.error.body')}</p>
      </div>

      {onRetry ? (
        <Button
          variant="primary"
          onPress={onRetry}
          icon={<RotateCcw className="size-4" />}
        >
          {t('action.retry')}
        </Button>
      ) : null}

      {reference ? (
        <p className="text-caption text-ink-2 tabular">
          {t('empty.error.reference', { reference })}
        </p>
      ) : null}
    </div>
  )
}
