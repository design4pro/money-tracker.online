import { Card, Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The loading pictures for the import screens.
 *
 * `/import` waits on three server functions at once — the parser registry, every account including
 * the closed ones, and the whole batch history — so it is one of the slower loaders in the app and
 * the one most likely to be reached on a phone with a statement already in hand. Until now it
 * declared nothing, which meant the reader sat on the previous screen with no sign anything was
 * happening.
 *
 * Every box is the size of the thing that replaces it: the two upload cards side by side above the
 * history table, so the page does not reflow when the real cards land. `Skeleton` is `aria-hidden`
 * throughout, and the one `role="status"` paragraph carries the whole announcement — the same
 * arrangement `recurring-skeletons.tsx` uses.
 */

function LoadingAnnouncement({ message }: { readonly message: string }) {
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  )
}

/** One upload group's stand-in: a two-line header, then the account picker and the drop zone. */
function UploadCardSkeleton() {
  return (
    <Card className="flex w-full flex-col gap-4">
      <div className="space-y-2">
        <Skeleton shape="text" className="h-4 w-44" />
        <Skeleton shape="text" className="h-3 w-full max-w-prose" />
      </div>
      <Skeleton shape="block" className="h-9 w-full rounded-md" />
      <Skeleton shape="block" className="h-24 w-full rounded-lg" />
    </Card>
  )
}

/**
 * The `/import` pending view: the page header, the two upload groups in their `lg:grid-cols-2`
 * pairing, and five history rows.
 *
 * The grid classes are the route's own, copied deliberately rather than approximated — a
 * single-column skeleton in front of a two-column screen is the sideways version of the jump this
 * exists to prevent.
 */
export function ImportPageSkeleton() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement message={t('import.list.loading')} />

      <div className="space-y-2">
        <Skeleton shape="block" className="h-8 w-40 rounded-md" />
        <Skeleton shape="text" className="h-3 w-full max-w-prose" />
      </div>

      <div className="grid items-stretch gap-5 lg:grid-cols-2">
        <UploadCardSkeleton />
        <UploadCardSkeleton />
      </div>

      <div className="flex flex-col gap-3">
        <div className="space-y-2">
          <Skeleton shape="text" className="h-4 w-36" />
          <Skeleton shape="text" className="h-3 w-72" />
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface shadow-card">
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 border-t border-border-subtle px-4 py-3 first:border-t-0"
            >
              <Skeleton shape="text" className="h-3 w-48" />
              <Skeleton shape="block" className="h-5 w-20 rounded-sm" />
              <Skeleton shape="text" className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The four step labels' stand-ins, at the widths the words themselves take. */
const STEP_WIDTHS = ['w-24', 'w-20', 'w-28', 'w-32'] as const

/**
 * The `/import/$batchId` pending view: the header, the four-step rail, and the current step's body.
 *
 * The rail is drawn at its full length on purpose. Upload, map, review, import is a promise the
 * screen makes before a reader is inside the flow, and a skeleton that shows two steps and then
 * grows to four breaks that promise in the one moment it is being made.
 *
 * The in-component `FileUnavailable` state is a different thing and is left alone: it is what the
 * *upload step* shows when the stored file cannot be read back, and it appears long after this
 * skeleton has gone.
 */
export function ImportBatchSkeleton() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement message={t('import.detail.loading')} />

      <div className="space-y-2">
        <Skeleton shape="block" className="h-8 w-40 rounded-md" />
        <Skeleton shape="text" className="h-3 w-56" />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {STEP_WIDTHS.map((width) => (
          <Skeleton key={width} shape="text" className={`h-4 ${width}`} />
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <Skeleton shape="text" className="h-4 w-32" />
        <Skeleton shape="text" className="h-3 w-full max-w-prose" />
        <Skeleton shape="block" className="h-40 w-full rounded-lg" />
      </div>
    </div>
  )
}
