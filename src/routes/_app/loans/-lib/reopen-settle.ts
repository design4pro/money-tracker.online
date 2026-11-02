import type { InstalmentView } from '#/server/repos/loans'

/**
 * The unpaid instalment `?markPaid=<sequence>` names, or none.
 *
 * Paid rows are ignored: the picker has nothing left to do there, and a stale address after a
 * successful link must not reopen on a row that no longer has a button.
 */
export function findReopenedInstalment(
  instalments: ReadonlyArray<InstalmentView>,
  sequence: number | undefined,
): InstalmentView | null {
  if (sequence === undefined) return null
  const row = instalments.find((item) => item.sequence === sequence)
  if (row === undefined || row.derivedStatus === 'paid') return null
  return row
}
