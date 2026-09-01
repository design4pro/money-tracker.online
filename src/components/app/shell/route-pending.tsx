import { Skeleton } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'

export interface RoutePendingProps {
  /** How many card placeholders to draw under the title. Default 4. */
  cards?: number
  className?: string
}

/**
 * What a guarded route shows while its loader is in flight.
 *
 * A skeleton of the layout that is coming, not a spinner on white. The difference is not
 * decoration: a spinner says "wait" and nothing else, while a shape says "a title, then a row of
 * figures, then a list" — so the reader's eye is already where the content will be when it lands,
 * and the page does not jump when it replaces this.
 *
 * The block is one `status` region carrying one sentence. The individual bars are
 * `aria-hidden`, because announcing eleven grey rectangles is worse than announcing nothing;
 * `aria-busy` on the container is what tells assistive technology the region is mid-update.
 *
 * `Skeleton` already drops its shimmer under `prefers-reduced-motion`.
 */
export function RoutePending({ cards = 4, className }: RoutePendingProps) {
  const t = useTranslate()

  return (
    <div
      role="status"
      aria-busy="true"
      className={cn('flex flex-col gap-8 py-2', className)}
    >
      <span className="sr-only">{t('app.shell.pending')}</span>

      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div
        aria-hidden="true"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {Array.from({ length: cards }, (_, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-5"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>

      <div
        aria-hidden="true"
        className="flex flex-col gap-px overflow-hidden rounded-xl border border-border-subtle bg-surface"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-4 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-40 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3.5 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
