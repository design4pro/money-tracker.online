import { createServerFn } from '@tanstack/react-start'

import { asCurrencyCode } from '#/lib/money'
import { requireOrg } from '#/server/auth/guards'
import { listAccountGroups, listAccounts } from '#/server/repos/accounts'
import { listCategories } from '#/server/repos/categories'
import { listPayees } from '#/server/repos/payees'
import { baseCurrencyOf } from '#/server/repos/workspace-currencies'

import type { TransactionReference } from '#/components/app/transactions'

/**
 * The vocabularies the transactions screen turns ids into names with.
 *
 * ## Why this is separate from the page load
 *
 * The rows change on every filter keystroke; the accounts, categories and payees do not. Folding
 * them into the paging request would re-read all four lists on every narrowing, and the router
 * would cache the set under a key that changes for reasons the vocabularies have nothing to do
 * with. Two requests with two lifetimes is fewer bytes over the wire than one request with the
 * shorter of the two.
 *
 * ## Why it is route-local
 *
 * It composes four repository calls and owns no SQL. That is exactly the shape the layering
 * contract puts in `-server/`: routes call server functions, server functions call repositories,
 * and no SQL lives outside `src/server/repos`. Nothing else in the product needs this particular
 * composition, so it stays beside the screen that does.
 *
 * ## `requireOrg()` is here, not in a `beforeLoad`
 *
 * A route guard is UX. This is the boundary: the membership is re-read on every call, and the
 * tenant scope it returns is what every query below is filtered by.
 *
 * ## Archived rows are included, on purpose
 *
 * The ledger is a record of what happened, and a two-year-old row whose category was archived last
 * spring still has to render its chip. A reference set that only held live rows would print an
 * unnamed chip beside a real transaction, which reads as data loss rather than as tidiness.
 *
 * ## Tags are still empty, and that is a state rather than a gap
 *
 * `tags` is plan `08-S2`. Until the tags repository exists this returns an empty collection, and
 * the filter panel removes the tag picker rather than rendering a control that can only be opened
 * to find nothing — which is also the correct behaviour for a real workspace that has never made a
 * tag.
 */
export const loadTransactionReference = createServerFn({
  method: 'GET',
}).handler(async (): Promise<TransactionReference> => {
  const scope = await requireOrg()

  const [{ accounts }, groups, categories, payees, baseCurrencyCode] =
    await Promise.all([
      // Archived accounts are included on purpose: they hold history, and a ledger that could not
      // name the account a two-year-old transaction was booked to would print "Unknown" beside it.
      listAccounts(scope, { includeExcluded: true }),
      listAccountGroups(scope),
      listCategories(scope, { includeArchived: true }),
      listPayees(scope),
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
    // Already in tree order — each parent followed by its own children — so the picker's list
    // reads the way the settings screen draws it without a second sort here.
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      // Resolved by the repository, never here: two components that each work out what colour a
      // child inherits are two components that will eventually disagree.
      color: category.color,
    })),
    payees: payees.map(({ payee }) => ({ id: payee.id, name: payee.name })),
    tags: [],
    baseCurrencyCode,
  }
})
