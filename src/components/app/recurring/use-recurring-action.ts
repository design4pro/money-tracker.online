import { useCallback } from 'react'

import { toast } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * What a screen does when somebody skips, resumes, reverts or unlinks - one failure policy, so the
 * three screens that offer these cannot disagree about it again.
 *
 * The returned `run` calls the server, toasts the outcome and reads the screen again once the call
 * has settled, **whichever way it settled**. A refusal is often the sign that the row on screen is
 * stale ("the period was settled in another tab"), so showing the failure and leaving the row where
 * it was is the one thing that must not happen. `run` never rejects: the call sites fire it with
 * `void`, and a rejection there has no toast and no refresh.
 *
 * ## What it does not know
 *
 * The server function, its arguments and the success message arrive as arguments - this directory
 * does not import `#/server/fns`, and which action it is stays the route's business. `refresh` is
 * the data-refresh hook's result (`useDataRefresh`, in the routes' `-lib`): it already invalidates
 * the router and the React Query caches, so no caller invalidates the router on top of it.
 */
export function useRecurringAction(
  refresh: () => Promise<void>,
): (call: () => Promise<unknown>, successMessage: string) => Promise<void> {
  const t = useTranslate()

  return useCallback(
    async (call, successMessage) => {
      try {
        await call()
        toast.success(successMessage)
      } catch {
        toast.error(t('recurring.toast.failed'))
      }
      // The outcome is already on screen; a failed re-read must not escape as an unhandled rejection.
      await refresh().catch(() => undefined)
    },
    [refresh, t],
  )
}
