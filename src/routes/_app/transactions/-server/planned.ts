import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { serverToday } from '#/server/clock'
import { loggerFromEnv } from '#/server/observability/logger'
import {
  transactionFiltersSchema,
  transactionSortSchema,
} from '#/server/repos/transaction-queries'
import { transactionPoliciesSchema } from '#/server/repos/transactions'
import { ledgerPageFor } from '#/server/transactions/ledger-page'

import { plannedScreenFor } from './planned-data'

import type { PlannedScreenPage } from './planned-data'

/**
 * The planned screen's server function: the door, and nothing else.
 *
 * It re-establishes who is asking (`requireOrg`, once), reads the day from the server clock (once,
 * never from the caller), validates what was asked for and hands all three to
 * {@link plannedScreenFor}, where every decision about the answer lives. The split follows the
 * dashboard's (`dashboard/-server/load-dashboard.ts`): this module is in the client graph, so the
 * composition sits in its own module and is imported only from inside the handler.
 *
 * ## The input is the ledger's own, and carries no scope
 *
 * The same four schemas `loadTransactions` validates with, reused rather than restated, so a filter
 * the ledger gains is a filter this accepts. There is no organisation id, no scope and no `today`
 * in it, and the schema is strict, so a client that sends one is refused rather than believed.
 *
 * ## The door proves membership once, for both halves
 *
 * The ledger half is `ledgerPageFor`, the body `loadTransactions` runs after its own `requireOrg`.
 * It takes a scope and resolves none, so this door calls `requireOrg` once and hands that one scope
 * to the ledger read and to the expected read. The scope is never derived from the input.
 */

const plannedScreenSchema = z.strictObject({
  policies: transactionPoliciesSchema,
  filters: transactionFiltersSchema,
  sort: transactionSortSchema,
  cursor: z.string().min(1).nullable(),
  limit: z.number().int().positive().optional(),
})

export const loadPlannedScreen = createServerFn({ method: 'GET' })
  .inputValidator(plannedScreenSchema)
  .handler(async ({ data }): Promise<PlannedScreenPage> => {
    const scope = await requireOrg()
    const { env } = await import('cloudflare:workers')
    return plannedScreenFor(scope, data, serverToday(), {
      readLedger: ledgerPageFor,
      logger: loggerFromEnv(env, {
        context: { component: 'transactions', route: 'planned' },
      }),
    })
  })
