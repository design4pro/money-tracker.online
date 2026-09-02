import { Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The entry form's shape, before it has any data in it.
 *
 * Drawn at the real geometry — heading, direction row, the tall amount field, the date/account
 * pair, three detail fields and the action row — rather than as a single grey slab. A skeleton that
 * is the wrong height lets the page jump under the reader's pointer the moment the accounts arrive,
 * which on a form whose first control takes focus automatically is how a keystroke lands somewhere
 * nobody intended.
 *
 * The status line is `sr-only` and permanent, so a screen reader is told the screen is loading
 * without a box of meaningless rectangles being described to it.
 */
export function TransactionFormSkeleton() {
  const t = useTranslate()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <p role="status" className="sr-only">
        {t('app.loading')}
      </p>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>

      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64 rounded-md" />
        <Skeleton className="h-14 w-full rounded-md" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-11 rounded-md" />
          <Skeleton className="h-11 rounded-md" />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-11 rounded-md" />
          <Skeleton className="h-11 rounded-md" />
        </div>
        <Skeleton className="h-24 w-full rounded-md" />
      </div>

      <div className="flex justify-end gap-2">
        <Skeleton className="h-10 w-24 rounded-md" />
        <Skeleton className="h-10 w-40 rounded-md" />
        <Skeleton className="h-10 w-24 rounded-md" />
      </div>
    </div>
  )
}
