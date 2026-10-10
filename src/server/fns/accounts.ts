/**
 * The account server functions: the only door between a route and `repos/accounts`.
 *
 * Three things happen here and nothing else does.
 *
 * **The input is validated with Zod** before it is believed, using the very schemas the repository
 * re-parses with. The second parse is not redundancy for its own sake — the importer, the seed and
 * the queue consumers reach the repository without passing this file, so the boundary check and
 * the repository check are two different doors on the same room.
 *
 * **The caller is authorised with `requireOrg()`**, which re-reads the membership rather than
 * trusting a session claim or a client-supplied workspace id. It is called *inside* every handler,
 * never in a `beforeLoad`: a route guard is UX, and an id in a URL is not an authorised id until a
 * tenant-scoped query has failed to find it somewhere else.
 *
 * **Every write runs inside `runWithLedgerBatch`**, which collects the accounts a call touched and
 * enqueues **one** rebuild for each after it settles — including when it throws, because by then
 * rows may already be committed. Creating an account with an opening balance, changing its
 * currency and correcting its balance all move the balance grid; renaming it does not, and the
 * repository is what knows the difference.
 *
 * The read functions are `GET` so they can be cached and prefetched by the router; every write is
 * `POST`. `listAccounts` returns the list **and** the overview totals in one response, so the
 * header on `/accounts` does not cost a second round trip.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { runWithLedgerBatch } from '#/server/ledger'
import {
  adjustAccountBalance as adjustAccountBalanceRow,
  adjustBalanceSchema,
  archiveAccount as archiveAccountRow,
  createAccount as createAccountRow,
  createAccountGroup as createAccountGroupRow,
  createAccountGroupSchema,
  createAccountSchema,
  deleteAccount as deleteAccountRow,
  deleteAccountGroup as deleteAccountGroupRow,
  getAccount as getAccountRow,
  getAccountBalanceOn as getAccountBalanceOnRow,
  getAccountBalanceOnSchema,
  listAccountGroups as listAccountGroupsRow,
  listAccounts as listAccountsRow,
  listAccountsSchema,
  reorderAccountGroups as reorderAccountGroupsRow,
  reorderAccountGroupsSchema,
  reorderAccounts as reorderAccountsRow,
  reorderAccountsSchema,
  restoreAccount as restoreAccountRow,
  setAccountGroupMembers as setAccountGroupMembersRow,
  setGroupMembersSchema,
  updateAccount as updateAccountRow,
  updateAccountGroup as updateAccountGroupRow,
  updateAccountGroupSchema,
  updateAccountSchema,
} from '#/server/repos/accounts'
import { conversionContextFor } from '#/server/repos/workspace-currencies'

import type { AccountGroupRow } from '#/server/db/schema'
import type { Account } from '#/server/db/types'
import type {
  AccountBalanceOn,
  AccountGroupWithMembers,
  AccountListResult,
  BalanceAdjustment,
} from '#/server/repos/accounts'

const accountIdSchema = z.strictObject({
  accountId: z.string().trim().min(1).max(64),
})

const groupIdSchema = z.strictObject({
  groupId: z.string().trim().min(1).max(64),
})

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The account list and the overview header, in one response.
 *
 * One call rather than two because the header is not optional decoration: `/accounts` is a screen
 * whose whole point is the total, and a second round trip for it is a second chance to render a
 * page with a number missing from the top of it.
 */
export const listAccounts = createServerFn({ method: 'GET' })
  .inputValidator(listAccountsSchema)
  .handler(async ({ data }): Promise<AccountListResult> => {
    const scope = await requireOrg()
    return listAccountsRow(scope, data)
  })

/** One account. An id belonging to another workspace is a `NotFoundError`, never a `403`. */
export const getAccount = createServerFn({ method: 'GET' })
  .inputValidator(accountIdSchema)
  .handler(async ({ data }): Promise<Account> => {
    const scope = await requireOrg()
    return getAccountRow(scope, data.accountId)
  })

/** Every group with its membership, flat and in display order. */
export const listAccountGroups = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReadonlyArray<AccountGroupWithMembers>> => {
    const scope = await requireOrg()
    return listAccountGroupsRow(scope)
  },
)

/* -------------------------------------------------------------------------- */
/* Account writes                                                              */
/* -------------------------------------------------------------------------- */

/** Creates an account. Batched, because a non-zero opening balance starts a balance history. */
export const createAccount = createServerFn({ method: 'POST' })
  .inputValidator(createAccountSchema)
  .handler(async ({ data }): Promise<Account> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      return createAccountRow(scope, data, await conversionContextFor(scope))
    }),
  )

const updateAccountInputSchema = z.strictObject({
  accountId: z.string().trim().min(1).max(64),
  patch: updateAccountSchema,
})

/**
 * Edits an account. Batched, because changing the currency or the opening balance re-values every
 * day of its history — the repository decides whether this particular patch did either.
 */
export const updateAccount = createServerFn({ method: 'POST' })
  .inputValidator(updateAccountInputSchema)
  .handler(async ({ data }): Promise<Account> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      return updateAccountRow(
        scope,
        data.accountId,
        data.patch,
        await conversionContextFor(scope),
      )
    }),
  )

/** Archives an account: reversible, keeps every row, and is what the UI offers before delete. */
export const archiveAccount = createServerFn({ method: 'POST' })
  .inputValidator(accountIdSchema)
  .handler(async ({ data }): Promise<Account> => {
    const scope = await requireOrg()
    return archiveAccountRow(scope, data.accountId)
  })

/** Restores an archived account. Batched: it counts towards the totals again. */
export const restoreAccount = createServerFn({ method: 'POST' })
  .inputValidator(accountIdSchema)
  .handler(async ({ data }): Promise<Account> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      return restoreAccountRow(scope, data.accountId)
    }),
  )

/** Deletes an account that has no history. The repository refuses — with the count — if it has. */
export const deleteAccount = createServerFn({ method: 'POST' })
  .inputValidator(accountIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await deleteAccountRow(scope, data.accountId)
  })

/** Rewrites the display order. One statement, and no balance moves, so no batch. */
export const reorderAccounts = createServerFn({ method: 'POST' })
  .inputValidator(reorderAccountsSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await reorderAccountsRow(scope, data.ids)
  })

/* -------------------------------------------------------------------------- */
/* The balance correction                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The balance at the end of a day, so the correction dialog can name the delta it is about to
 * write for any date. Any member may call it, like reading an account: the repository's account
 * lookup is the authoriser, and the schema only checks shape.
 */
export const getAccountBalanceOn = createServerFn({ method: 'GET' })
  .inputValidator(getAccountBalanceOnSchema)
  .handler(async ({ data }): Promise<AccountBalanceOn> => {
    const scope = await requireOrg()
    return getAccountBalanceOnRow(scope, data)
  })

/**
 * Records a correction as a real transaction, or reports that none was needed.
 *
 * Batched like any other transaction write, because that is exactly what it is. The response
 * carries the delta the repository computed, so the screen can say what it recorded rather than
 * quietly closing a dialog: a person who states a target and is shown nothing has no way to know
 * whether the correction was applied once or twice.
 */
export const adjustAccountBalance = createServerFn({ method: 'POST' })
  .inputValidator(adjustBalanceSchema)
  .handler(async ({ data }): Promise<BalanceAdjustment> =>
    runWithLedgerBatch(async () => {
      const scope = await requireOrg()
      return adjustAccountBalanceRow(
        scope,
        data,
        await conversionContextFor(scope),
      )
    }),
  )

/* -------------------------------------------------------------------------- */
/* Group writes                                                                */
/* -------------------------------------------------------------------------- */

/** Creates a group. No balance moves and no metric is consumed: a group is organisation. */
export const createAccountGroup = createServerFn({ method: 'POST' })
  .inputValidator(createAccountGroupSchema)
  .handler(async ({ data }): Promise<AccountGroupRow> => {
    const scope = await requireOrg()
    return createAccountGroupRow(scope, data)
  })

const updateAccountGroupInputSchema = z.strictObject({
  groupId: z.string().trim().min(1).max(64),
  patch: updateAccountGroupSchema,
})

/** Edits a group, including its parent. The one-level rule is enforced in the repository. */
export const updateAccountGroup = createServerFn({ method: 'POST' })
  .inputValidator(updateAccountGroupInputSchema)
  .handler(async ({ data }): Promise<AccountGroupRow> => {
    const scope = await requireOrg()
    return updateAccountGroupRow(scope, data.groupId, data.patch)
  })

/** Deletes a group. Its accounts become ungrouped; none of them is touched otherwise. */
export const deleteAccountGroup = createServerFn({ method: 'POST' })
  .inputValidator(groupIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await deleteAccountGroupRow(scope, data.groupId)
  })

/** Replaces a group's membership wholesale, in the order given. */
export const setAccountGroupMembers = createServerFn({ method: 'POST' })
  .inputValidator(setGroupMembersSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await setAccountGroupMembersRow(scope, data.groupId, data.accountIds)
  })

/** Rewrites the group order. */
export const reorderAccountGroups = createServerFn({ method: 'POST' })
  .inputValidator(reorderAccountGroupsSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await reorderAccountGroupsRow(scope, data.ids)
  })
