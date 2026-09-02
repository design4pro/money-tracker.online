import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import {
  RULE_PREVIEW_SCAN_LIMIT,
  loadRulePreviewTargets,
} from '#/server/repos/rule-preview'
import { evaluateRule } from '#/server/rules/evaluate'
import { ruleDefinitionSchema } from '#/server/rules/schema'

import type { TransactionDirection } from '#/server/db/schema'

/**
 * `previewRule` — what an **unsaved** rule would have matched, before anything is written.
 *
 * ---------------------------------------------------------------------------
 * BOTH COUNTS, ALWAYS
 * ---------------------------------------------------------------------------
 *
 * "12 matches" is not a fact a person can use. *Twelve out of the last two thousand* is. So the
 * response carries `scannedCount` beside `matchedCount` and the screen prints both — a preview that
 * scanned a window while implying it had read the whole ledger is worse than no preview, because
 * the person believes it. `scannedCount` is the number of rows actually read, not the cap: a
 * workspace with 40 transactions is told 40.
 *
 * ---------------------------------------------------------------------------
 * WHY IT PARSES WITH `ruleDefinitionSchema`
 * ---------------------------------------------------------------------------
 *
 * The very schema `createRule` and `updateRule` parse with, unchanged. That is the whole reason
 * `14-S1` put it in `#/server/rules/schema` rather than beside `createRuleSchema`: the preview
 * cannot evaluate a rule the save path would reject, so nobody can be shown twelve matches for a
 * rule that will not save. A second, looser schema here would be exactly that bug.
 *
 * ---------------------------------------------------------------------------
 * IT NEVER WRITES, AND IT COSTS NOTHING
 * ---------------------------------------------------------------------------
 *
 * Three `select`s and a fold. No counter is incremented, no rule row is touched, no quota is
 * consumed — the rule was counted at creation (`14-S1`) and a preview is not a rule. The cap makes
 * it bounded: an editor firing on a debounce cannot turn into an expensive endpoint.
 *
 * `requireOrg()` is inside the handler and never in a `beforeLoad`. A route guard is UX; this is
 * the boundary, and every row read below is filtered by the scope it returns.
 */

const previewInputSchema = z.strictObject({ rule: ruleDefinitionSchema })

/** One matched row, as the preview lists it. Enough to recognise the transaction, and no more. */
export interface RulePreviewSample {
  readonly transactionId: string
  readonly bookedOn: string
  readonly payeeName: string | null
  readonly note: string | null
  readonly amountMinor: number
  readonly currencyCode: string
  readonly direction: TransactionDirection
}

export interface RulePreviewResult {
  /** How many of the scanned rows the rule matched. */
  readonly matchedCount: number
  /** How many rows were actually read. Never larger than {@link RULE_PREVIEW_SCAN_LIMIT}. */
  readonly scannedCount: number
  /** At most ten, newest first — the same order the rows were scanned in. */
  readonly samples: ReadonlyArray<RulePreviewSample>
}

/** Ten is a sample, not a page. More would be a second transaction list on a screen that has one. */
const MAX_SAMPLES = 10

export const previewRule = createServerFn({ method: 'POST' })
  .inputValidator(previewInputSchema)
  .handler(async ({ data }): Promise<RulePreviewResult> => {
    const scope = await requireOrg()
    const targets = await loadRulePreviewTargets(scope, RULE_PREVIEW_SCAN_LIMIT)

    const samples: Array<RulePreviewSample> = []
    let matchedCount = 0

    for (const target of targets) {
      if (!evaluateRule(data.rule, target)) continue
      matchedCount += 1
      // The loop runs to the end even once ten samples are held: `matchedCount` is a count over the
      // whole window, and stopping early would report "10 of 2 000" for every rule that matches
      // more than ten rows.
      if (samples.length < MAX_SAMPLES) {
        samples.push({
          transactionId: target.transactionId,
          bookedOn: target.bookedOn,
          payeeName: target.payeeName,
          note: target.note,
          amountMinor: target.amountMinor,
          currencyCode: target.currencyCode,
          direction: target.direction,
        })
      }
    }

    return { matchedCount, scannedCount: targets.length, samples }
  })
