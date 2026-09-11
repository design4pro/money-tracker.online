import { Store } from 'lucide-react'

import { Button, EmptyState, Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The payee list before anything is in it, and after a search that found nothing.
 *
 * The two cases get different sentences on purpose. "No payees yet" on a filtered list is a lie
 * that sends somebody looking for a bug, and each message names its own way out.
 */
export function PayeeEmptyState({
  isFiltered,
  onCreate,
}: {
  isFiltered: boolean
  onCreate: () => void
}) {
  const t = useTranslate()
  return (
    <EmptyState
      icon={<Store aria-hidden="true" />}
      title={t(isFiltered ? 'payees.noMatches.title' : 'payees.empty.title')}
      description={t(
        isFiltered ? 'payees.noMatches.body' : 'payees.empty.body',
      )}
      headingLevel={2}
      action={
        isFiltered ? undefined : (
          <Button variant="primary" onPress={onCreate}>
            {t('payees.create')}
          </Button>
        )
      }
    />
  )
}

/**
 * One payee's screen while its loader is in flight.
 *
 * The shape is the detail screen's: a back link, an avatar beside a name and a badge, then the
 * alias card. Drawing that rather than a generic block is what keeps the page from jumping when
 * the real content lands, and it is why this lives beside the list skeleton instead of falling
 * back to the router's default.
 *
 * One `status` region carrying one sentence, with every bar `aria-hidden` — the same contract
 * {@link PayeeListSkeleton} keeps, so a screen reader hears "Loading this payee…" once and not a
 * description of nine rectangles.
 */
export function PayeeDetailSkeleton() {
  const t = useTranslate()
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('payees.detail.loading')}
      className="flex flex-col gap-6"
    >
      <Skeleton aria-hidden="true" shape="text" className="w-32" />

      <div aria-hidden="true" className="flex items-center gap-3">
        <Skeleton shape="circle" className="size-12" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton shape="text" className="w-64" />
        </div>
      </div>

      <div
        aria-hidden="true"
        className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-5"
      >
        <Skeleton className="h-5 w-40" />
        <Skeleton shape="text" className="w-full max-w-prose" />
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} shape="text" className="w-56" />
        ))}
      </div>
    </div>
  )
}

/** Eight grey rows while the list loads. Every `Skeleton` is `aria-hidden`; the region speaks. */
export function PayeeListSkeleton() {
  const t = useTranslate()
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('payees.loading')}
      className="flex flex-col gap-1"
    >
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <div
          key={row}
          className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface px-3 py-3"
        >
          <Skeleton shape="circle" className="size-8" />
          <Skeleton shape="text" className="w-48" />
        </div>
      ))}
    </div>
  )
}
