import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

/**
 * The one thing every finance write has to do afterwards: make the rest of the app stop showing
 * the figures it had before.
 *
 * ## Why this is a shared hook rather than a line in each mutation
 *
 * The app caches the same rows in two different places, and a write invalidates both:
 *
 * - **Route loaders** (`/dashboard`, `/accounts`, `/accounts/$accountId`) hold their data in the
 *   router. `router.invalidate()` reruns them.
 * - **React Query** holds the ledger page, the detail row and the reference set (accounts,
 *   categories, payees) under the `['transactions', …]` key prefix. `invalidateQueries` marks them
 *   stale so the mounted ones refetch and the unmounted ones refetch on their next mount.
 *
 * Every write touches both halves, and that is not obvious from either call site. Creating a
 * transaction moves an account balance, which is loader data; creating an account changes the
 * account list the transaction form offers, which is React Query data held for five minutes. A
 * mutation that refreshed only its own half shipped twice already — the ledger showed *"Nothing
 * recorded yet"* on the page it had just navigated to after a successful save, because the create
 * screen invalidated nothing at all and the list was answered from a cache written before the row
 * existed.
 *
 * So the rule is one call, from every write path, and no judgement at the call site about which
 * half is affected. It is one round trip against a local D1 and it is the difference between a
 * ledger that is true and a ledger that is true after a manual reload.
 */
export function useDataRefresh(): () => Promise<void> {
  const queryClient = useQueryClient()
  const router = useRouter()

  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      router.invalidate(),
    ])
  }, [queryClient, router])
}
