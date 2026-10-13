import { AlertTriangle } from 'lucide-react'
import { useId, useRef } from 'react'

import { Button, Card } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'

import { useFocusHeading } from './use-focus-heading'

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
 * ## Alert or region
 *
 * `role="alert"` by default, because this panel appears in response to something the reader just
 * did. `mode="region"` is for a block that failed to load on arrival (a widget, a tab): an alert
 * on initial render is announced before the person has any context for it, so it is a labelled
 * region instead. It is also what a caller uses when it supplies the live region itself, as the
 * categories screen does for a refused write.
 *
 * ## The opt-in props
 *
 * `tone`, `mode`, `headingLevel`, `focusHeading` and `actions` all default to today's render, so
 * the modules that pass none of them are unchanged. `FailurePanel` is what sets them. The tone is
 * a static map of full class names: Tailwind cannot see one built from a variable.
 *
 * `focusHeading` moves keyboard focus to the heading on mount and gives it back when the panel
 * goes away holding it (`useFocusHeading`). Only an after-action panel sets it.
 */
export interface ErrorPanelProps {
  title: ReactNode
  body: ReactNode
  /** The raw error text, shown under a disclosure. Never the primary message. */
  detail?: string | null
  onRetry?: () => void
  isRetrying?: boolean
  /** `negative` is a fault; `warning` is a limit the reader can act on. */
  tone?: ErrorPanelTone
  /** `alert` for the result of an action, `region` for a block that failed to load. */
  mode?: 'alert' | 'region'
  headingLevel?: 2 | 3 | 4
  /** Move focus to the heading on mount, and give it back when the panel goes away. */
  focusHeading?: boolean
  /** Further ways out, beside Retry. */
  actions?: ReactNode
  className?: string
}

export type ErrorPanelTone = 'negative' | 'warning'

const TONE_CLASSES = {
  negative: {
    card: 'border-negative/30',
    glyph: 'bg-negative-soft text-negative',
  },
  warning: {
    card: 'border-warning/30',
    glyph: 'bg-warning-soft text-warning',
  },
} as const satisfies Record<ErrorPanelTone, { card: string; glyph: string }>

export function ErrorPanel({
  title,
  body,
  detail,
  onRetry,
  isRetrying = false,
  tone = 'negative',
  mode = 'alert',
  headingLevel = 3,
  focusHeading = false,
  actions,
  className,
}: ErrorPanelProps) {
  const t = useTranslate()
  const headingId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useFocusHeading(focusHeading, panelRef, headingRef)

  const Heading = `h${headingLevel}` as const
  const isRegion = mode === 'region'

  return (
    <Card
      ref={panelRef}
      role={isRegion ? 'region' : 'alert'}
      aria-labelledby={isRegion ? headingId : undefined}
      className={cn('flex flex-col gap-3', TONE_CLASSES[tone].card, className)}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-full',
            TONE_CLASSES[tone].glyph,
          )}
        >
          <AlertTriangle className="size-4" />
        </span>
        <div className="min-w-0">
          <Heading
            ref={headingRef}
            id={isRegion ? headingId : undefined}
            tabIndex={focusHeading ? -1 : undefined}
            className="text-subtitle font-semibold text-ink outline-none"
          >
            {title}
          </Heading>
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

      {onRetry || actions ? (
        <div className="flex flex-wrap justify-start gap-3">
          {onRetry ? (
            <Button
              variant="secondary"
              onPress={onRetry}
              isPending={isRetrying}
            >
              {t('action.retry')}
            </Button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </Card>
  )
}
