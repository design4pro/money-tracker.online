import { Card, Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

function LoadingAnnouncement({ message }: { readonly message: string }) {
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  )
}

/** The `/loans` pending view: three cards with the meter's space reserved. */
export function LoanListSkeleton() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement message={t('loans.list.loading')} />
      <dl className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <div
            key={tile}
            className="flex items-baseline justify-between gap-3 border-t border-border-subtle py-3"
          >
            <Skeleton shape="text" className="h-3 w-24" />
            <Skeleton shape="text" className="h-5 w-20" />
          </div>
        ))}
      </dl>
      <ul className="rounded-xl border border-border-subtle bg-surface shadow-card">
        {[0, 1, 2].map((row) => (
          <li
            key={row}
            className="flex flex-col gap-3 border-t border-border-subtle px-4 py-4 first:border-t-0"
          >
            <Skeleton shape="text" className="h-4 w-40" />
            <Skeleton shape="text" className="h-3 w-52" />
            <Skeleton shape="text" className="h-5 w-32" />
            <Skeleton shape="block" className="h-1.5 w-full rounded-sm" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The `/loans/months` pending view: filter row plus a reserved chart and grid. */
export function LoanCalendarSkeleton() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement message={t('loans.calendar.loading')} />
      <Skeleton shape="text" className="h-8 w-64" />
      <Skeleton shape="text" className="h-4 w-96 max-w-full" />
      <div className="flex gap-4">
        <Skeleton shape="block" className="h-11 w-64" />
        <Skeleton shape="block" className="h-11 w-64" />
      </div>
      <Card>
        <Skeleton shape="block" className="h-60 w-full" />
      </Card>
      <Skeleton shape="block" className="h-40 w-full" />
    </div>
  )
}

/** The `/loans/$loanId` pending view: header card plus eight schedule rows. */
export function LoanDetailSkeleton() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-6">
      <LoadingAnnouncement message={t('loans.detail.loading')} />
      <Card className="flex flex-col gap-4">
        <Skeleton shape="text" className="h-3 w-28" />
        <Skeleton shape="text" className="h-8 w-48" />
        <Skeleton shape="block" className="h-2 w-full rounded-sm" />
      </Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-xl">
          <tbody>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
              <tr key={row} className="border-t border-border-subtle">
                <td className="py-3">
                  <Skeleton shape="text" className="h-4 w-8" />
                </td>
                <td className="py-3">
                  <Skeleton shape="text" className="h-4 w-24" />
                </td>
                <td className="py-3">
                  <Skeleton shape="text" className="ml-auto h-4 w-20" />
                </td>
                <td className="py-3">
                  <Skeleton shape="text" className="h-4 w-16" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
