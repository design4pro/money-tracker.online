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
