import { Card, Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The loading pictures for the three recurring screens.
 *
 * Every box is the size of the thing that replaces it - a card's two-line header, the amount, the
 * due sentence beneath it - so nothing jumps when the numbers land. A skeleton whose proportions
 * are approximate produces exactly the shift it exists to prevent.
 *
 * `Skeleton` is `aria-hidden`, so the shapes say nothing; the region says "Loading your recurring
 * series…" once, politely, which is the whole of what a screen-reader user needs here.
 */

function LoadingAnnouncement({ message }: { readonly message: string }) {
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  )
}

/** The `/recurring` pending view: three cards with the amount and due line reserved. */
export function RecurringListSkeleton() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement message={t('recurring.list.loading')} />
      <ul className="rounded-xl border border-border-subtle bg-surface shadow-card">
        {[0, 1, 2].map((row) => (
          <li
            key={row}
            className="flex flex-col gap-3 border-t border-border-subtle px-4 py-4 first:border-t-0"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="w-full max-w-56">
                <Skeleton shape="text" className="h-4 w-40" />
                <Skeleton shape="text" className="mt-2 h-3 w-52" />
              </div>
              <Skeleton shape="block" className="size-9 rounded-md" />
            </div>
            <Skeleton shape="text" className="h-4 w-32" />
            <Skeleton shape="text" className="h-3 w-2/3" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The `/recurring/$seriesId` pending view: the header block and six period rows. */
export function SeriesDetailSkeleton() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement message={t('recurring.detail.loading')} />

      <Card className="flex flex-col gap-4">
        <Skeleton shape="text" className="h-3 w-28" />
        <Skeleton shape="block" className="h-9 w-56 rounded-md" />
        <Skeleton shape="text" className="h-3 w-3/4" />
      </Card>

      <Card className="flex flex-col gap-3">
        <Skeleton shape="text" className="h-3 w-40" />
        <Skeleton shape="text" lines={6} />
      </Card>
    </div>
  )
}

/** The `/recurring/candidates` pending view: three proposal cards. */
export function CandidateListSkeleton() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement message={t('recurring.candidates.loading')} />
      <ul className="rounded-xl border border-border-subtle bg-surface shadow-card">
        {[0, 1, 2].map((row) => (
          <li
            key={row}
            className="flex flex-col gap-3 border-t border-border-subtle px-4 py-4 first:border-t-0"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="w-full max-w-56">
                <Skeleton shape="text" className="h-4 w-40" />
                <Skeleton shape="text" className="mt-2 h-3 w-48" />
              </div>
              <Skeleton shape="block" className="h-6 w-28 rounded-full" />
            </div>
            <Skeleton shape="text" className="h-4 w-28" />
            <Skeleton shape="text" lines={2} />
          </li>
        ))}
      </ul>
    </div>
  )
}
