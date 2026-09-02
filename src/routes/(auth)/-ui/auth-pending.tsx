import { Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * What the auth column shows while the group's loader is in flight.
 *
 * The same shapes, at the same sizes, in the same places as the form that replaces it — a heading,
 * a line of prose, two labelled fields and a full-width action. Nothing moves when the real screen
 * arrives, which is the whole reason this is a skeleton and not a spinner: a spinner on white
 * reserves no space, so the sign-in form appears by shoving the page around, and a reader who had
 * already reached for the email box is now clicking somewhere else.
 *
 * One `status` region, one sentence, and every bar `aria-hidden` — see `RoutePending`, which makes
 * the same argument for the guarded shell.
 */
export function AuthPending() {
  const t = useTranslate()

  return (
    <div role="status" aria-busy="true" className="flex w-full flex-col gap-7">
      <span className="sr-only">{t('app.shell.pending')}</span>

      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-4 w-52 max-w-full" />
      </div>

      <div aria-hidden="true" className="flex flex-col gap-5">
        {[0, 1].map((row) => (
          <div key={row} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        ))}
        <Skeleton className="h-12 w-full rounded-md" />
      </div>
    </div>
  )
}
