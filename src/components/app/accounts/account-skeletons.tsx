import { Card, Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The loading pictures for the two account screens.
 *
 * ## They are measured against the real layout, not sketched
 *
 * Every box below is the size of the thing that replaces it: the overview's figure blocks, the
 * two tiles under them, four account rows at the height an account row actually is. That is the
 * whole point — a skeleton whose proportions are approximate produces a jump at the moment the
 * data lands, and the jump is worse than a blank space would have been.
 *
 * ## One announcement, not thirty
 *
 * `Skeleton` is `aria-hidden` by design, so the shapes say nothing. The region says "Loading
 * your accounts…" once, in a polite live region, which is the whole of what a screen-reader user
 * needs from a loading state.
 */

function LoadingAnnouncement() {
  const t = useTranslate()
  return (
    <p role="status" className="sr-only">
      {t('accounts.list.loading')}
    </p>
  )
}

/** The `/accounts` pending view: overview, per-currency card, four rows. */
export function AccountListSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="flex flex-col gap-5">
          <div className="flex items-end justify-between gap-6">
            <div className="w-40">
              <Skeleton shape="text" className="h-3 w-24" />
              <Skeleton shape="block" className="mt-2 h-9 w-40 rounded-md" />
            </div>
            <Skeleton shape="text" className="h-3 w-32" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton shape="block" className="h-[70px] rounded-lg" />
            <Skeleton shape="block" className="h-[70px] rounded-lg" />
          </div>
          <Skeleton shape="text" className="h-3 w-3/4" />
        </Card>

        <Card className="flex flex-col gap-3">
          <Skeleton shape="text" className="h-3 w-28" />
          <Skeleton shape="text" lines={3} />
        </Card>
      </div>

      {/* One card, four 64px rows, hairlines between them — the shape the list actually has,
          so nothing jumps when the data lands. */}
      <ul className="rounded-xl border border-border-subtle bg-surface shadow-card">
        {[0, 1, 2, 3].map((row) => (
          <li
            key={row}
            className="flex min-h-16 items-center gap-3 border-t border-border-subtle px-4 py-3 first:border-t-0"
          >
            <Skeleton shape="block" className="size-10 shrink-0 rounded-lg" />
            <div className="flex-1">
              <Skeleton shape="text" className="h-4 w-40" />
              <Skeleton shape="text" className="mt-1 h-3 w-24" />
            </div>
            <Skeleton shape="block" className="h-6 w-28 rounded-sm" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The `/accounts/$accountId` pending view: header block, tab strip, one panel. */
export function AccountDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement />

      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <Skeleton shape="block" className="size-12 shrink-0 rounded-lg" />
          <div className="flex-1">
            <Skeleton shape="text" className="h-5 w-48" />
            <Skeleton shape="text" className="mt-2 h-3 w-32" />
          </div>
        </div>
        <div>
          <Skeleton shape="text" className="h-3 w-24" />
          <Skeleton shape="block" className="mt-2 h-9 w-52 rounded-md" />
        </div>
      </Card>

      <Skeleton shape="block" className="h-10 w-64 rounded-md" />

      <Card className="flex flex-col gap-4">
        <Skeleton shape="text" className="h-3 w-32" />
        <Skeleton shape="text" lines={4} />
      </Card>
    </div>
  )
}
