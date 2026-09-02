/**
 * The rule server functions: the only door between a route and the rule engine.
 *
 * Three things happen here and nothing else does — the same three as `fns/goals`.
 *
 * **The input is validated with Zod**, using the very schemas the repository re-parses with. The
 * second parse is not redundancy for its own sake: the importer and the seed reach that repository
 * without passing this file.
 *
 * **The caller is authorised with `requireOrg()`**, inside every handler and never in a
 * `beforeLoad`. A route guard is UX; a rule id in a URL is not an authorised id until a
 * tenant-scoped query has failed to find it somewhere else.
 *
 * **No write here is batched, and that is a statement rather than an omission.** A rule changes a
 * category, a payee, tags, a note and two flags — never an amount, a currency or a date — so
 * nothing it does can move a point of a balance history. `runWithLedgerBatch` is deliberately
 * absent from this file; if it ever appears, either an action started writing money or somebody
 * added it defensively, and both are worth catching in review.
 *
 * Reads are `GET` so the router can cache and prefetch them; every write is `POST`.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { RULE_TRIGGERS } from '#/server/rules/schema'
import { applyRules as applyRulesToTransactions } from '#/server/rules/apply'
import {
  MAX_SUBJECTS_PER_RUN,
  createRule as createRuleRow,
  createRuleSchema,
  deleteRule as deleteRuleRow,
  getRule as getRuleRow,
  listRules as listRulesRow,
  reorderRules as reorderRulesRow,
  reorderRulesSchema,
  setRuleActive as setRuleActiveRow,
  updateRuleSchema,
  updateRule as updateRuleRow,
} from '#/server/repos/rules'

import type { Rule } from '#/server/repos/rules'

const ruleIdSchema = z.strictObject({
  ruleId: z.string().trim().min(1).max(64),
})

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Every rule the workspace has, in the order they run. The list screen's one call. */
export const loadRules = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReadonlyArray<Rule>> => listRulesRow(await requireOrg()),
)

/** One rule, for the editor. A foreign id is a `NotFoundError`, decided by the repository. */
export const loadRule = createServerFn({ method: 'GET' })
  .inputValidator(ruleIdSchema)
  .handler(async ({ data }): Promise<Rule> => {
    const scope = await requireOrg()
    return getRuleRow(scope, data.ruleId)
  })

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** Creates a rule at the end of the order. Both ceilings are enforced inside the repository. */
export const createRule = createServerFn({ method: 'POST' })
  .inputValidator(createRuleSchema)
  .handler(async ({ data }): Promise<{ readonly ruleId: string }> => {
    const scope = await requireOrg()
    const rule = await createRuleRow(scope, data)
    return { ruleId: rule.id }
  })

const updateInputSchema = z.strictObject({
  ruleId: z.string().trim().min(1).max(64),
  patch: updateRuleSchema,
})

/** Edits a rule. An edit clears a pause, because replacing the broken reference is the fix. */
export const updateRule = createServerFn({ method: 'POST' })
  .inputValidator(updateInputSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await updateRuleRow(scope, data.ruleId, data.patch)
  })

/** Deletes a rule. Nothing it has already written to a transaction is undone. */
export const deleteRule = createServerFn({ method: 'POST' })
  .inputValidator(ruleIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await deleteRuleRow(scope, data.ruleId)
  })

/**
 * Rewrites the order.
 *
 * The whole list, front to back, in one call rather than a move-up/move-down pair: order decides
 * outcomes here, and two concurrent single-step moves can interleave into an order neither person
 * asked for.
 */
export const reorderRules = createServerFn({ method: 'POST' })
  .inputValidator(reorderRulesSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await reorderRulesRow(scope, data.ids)
  })

const setActiveInputSchema = z.strictObject({
  ruleId: z.string().trim().min(1).max(64),
  isActive: z.boolean(),
})

/** Switches a rule on or off. Not a pause: a pause is `14-S3`, and it has a reason attached. */
export const setRuleActive = createServerFn({ method: 'POST' })
  .inputValidator(setActiveInputSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await setRuleActiveRow(scope, data.ruleId, data.isActive)
  })

/**
 * Runs the rule set over transactions that were just written.
 *
 * The transaction list is capped at one run's worth, computed from D1's bound-parameter ceiling:
 * an importer with five thousand rows calls this once per chunk, which is also what keeps the
 * counter update to one statement per chunk rather than one per row.
 */
const applyRulesInputSchema = z.strictObject({
  transactionIds: z
    .array(z.string().trim().min(1).max(64))
    .min(1)
    .max(MAX_SUBJECTS_PER_RUN),
  trigger: z.enum(RULE_TRIGGERS),
})

export const applyRules = createServerFn({ method: 'POST' })
  .inputValidator(applyRulesInputSchema)
  .handler(
    async ({
      data,
    }): Promise<{
      readonly scannedCount: number
      readonly changedCount: number
    }> => {
      const scope = await requireOrg()
      const result = await applyRulesToTransactions(scope, data)
      return {
        scannedCount: result.scannedCount,
        changedCount: result.changedCount,
      }
    },
  )
