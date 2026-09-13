import { AlertTriangle } from 'lucide-react'

import { Button, Card } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'

import type { ReactNode } from 'react'

/**
 * The retryable failure panel for a region that could not load.
 *
 * It replaces the region it belongs to and nothing else, which is the point: a failing detail
 * tab must not blank the header above it, and a failing account list must not take the shell
 * with it.
 *
 * ## The wording rule
 *
 * The title says what did not happen; the body says whether anything was changed. "Nothing was
 * changed" is the sentence a person reading a finance app needs first, and it is why the copy is
 * a prop rather than a generic string baked in here.
 *
 * ## Why the raw message is behind a disclosure
 *
 * A repository error reads `Account 01k… still has 412 transaction(s)`. It is written for a
 * developer, it is English-only, and putting it in the body would replace a localised sentence
 * with a technical one. It stays available — a person filing a bug needs it — inside a
 * `<details>` that starts closed.
 *
 * `role="alert"` because this panel appears in response to something the reader just did.
 */
export interface ErrorPanelProps {
  title: ReactNode
  body: ReactNode
  /** The raw error text, shown under a disclosure. Never the primary message. */
  detail?: string | null
  onRetry?: () => void
  isRetrying?: boolean
  className?: string
}

export function ErrorPanel({
  title,
  body,
  detail,
  onRetry,
  isRetrying = false,
  className,
}: ErrorPanelProps) {
  const t = useTranslate()

  return (
    <Card
      role="alert"
      className={cn('flex flex-col gap-3 border-negative/30', className)}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-negative-soft text-negative"
        >
          <AlertTriangle className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-subtitle font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-body text-ink-2">{body}</p>
        </div>
      </div>

      {detail ? (
        <details className="rounded-md bg-surface-sunken px-3 py-2">
          <summary className="cursor-pointer text-caption font-medium text-ink-2 target-min-h">
            {t('common.description')}
          </summary>
          <p className="mt-2 break-words text-caption text-ink-2">{detail}</p>
        </details>
      ) : null}

      {onRetry ? (
        <div className="flex justify-start">
          <Button variant="secondary" onPress={onRetry} isPending={isRetrying}>
            {t('action.retry')}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
