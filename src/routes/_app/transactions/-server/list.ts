import { createServerFn } from '@tanstack/react-start'

import { asCurrencyCode } from '#/lib/money'
import { requireOrg } from '#/server/auth/guards'
import { listAccountGroups, listAccounts } from '#/server/repos/accounts'
import { baseCurrencyOf } from '#/server/repos/workspace-currencies'

import type { TransactionReference } from '#/components/app/transactions'

/**
 * The vocabularies the transactions screen turns ids into names with.
 *
 * ## Why this is separate from the page load
 *
 * The rows change on every filter keystroke; the accounts do not. Folding them into the paging
 * request would re-read the whole account list on every narrowing, and the router would cache the
 * pair under a key that changes for reasons the accounts have nothing to do with. Two requests with
 * two lifetimes is fewer bytes over the wire than one request with the shorter of the two.
 *
 * ## Why it is route-local
 *
 * It composes two repository calls and owns no SQL. That is exactly the shape the layering contract
 * puts in `-server/`: routes call server functions, server functions call repositories, and no SQL
 * lives outside `src/server/repos`. Nothing else in the product needs this particular composition,
 * so it stays beside the screen that does.
 *
 * ## `requireOrg()` is here, not in a `beforeLoad`
 *
 * A route guard is UX. This is the boundary: the membership is re-read on every call, and the
 * tenant scope it returns is what every query below is filtered by.
 *
 * ## What is missing, and why it is empty rather than absent
 *
 * Categories, payees and tags are plan `08`'s vocabularies. Until they exist this returns empty
 * collections, and the filter panel removes their pickers rather than rendering controls that can
 * only be opened to find nothing — which is also the correct behaviour for a real workspace that
 * has never made a tag.
 */
export const loadTransactionReference = createServerFn({
  method: 'GET',
}).handler(async (): Promise<TransactionReference> => {
  const scope = await requireOrg()

  const [{ accounts }, groups, baseCurrencyCode] = await Promise.all([
    // Archived accounts are included on purpose: they hold history, and a ledger that could not
    // name the account a two-year-old transaction was booked to would print "Unknown" beside it.
    listAccounts(scope, { includeExcluded: true }),
    listAccountGroups(scope),
    baseCurrencyOf(scope),
  ])

  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currencyCode: asCurrencyCode(account.currencyCode),
      isArchived: account.status === 'archived',
    })),
    accountGroups: groups.map(({ group }) => ({
      id: group.id,
      name: group.name,
    })),
    categories: [],
    payees: [],
    tags: [],
    baseCurrencyCode,
  }
})
