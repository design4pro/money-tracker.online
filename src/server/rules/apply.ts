/**
 * Running the rule set: what order, what wins, and what a run is allowed to write.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER, AND WHAT WINS
 * ---------------------------------------------------------------------------
 *
 * Rules run in **`position` order, ties broken by rule id** (`repos/rules` composes that `ORDER
 * BY`), and their actions are applied **cumulatively**. So when two rules both set a category, the
 * **later** one wins — the last write to a field is the field's value, exactly as reading the list
 * top to bottom would suggest. That is the whole ordering contract, it is pinned by
 * `__tests__/apply.test.ts`, and it means two runs over the same transaction and the same rule set
 * always produce the same result.
 *
 * **The run stops after the last rule. There is no re-run loop.** A rule set that reacts to its own
 * output does not terminate predictably: rule 1 tags what rule 4 untags, and a second pass swaps
 * them forever. One pass, in one direction, and a person who wants a rule to see another rule's
 * output puts it lower in the list.
 *
 * **`run_on` gates the whole rule, not an action.** A rule that does not list this trigger is not
 * evaluated at all, and a rule with an empty `run_on` is inert on every trigger — `14-S2`'s editor
 * shows it as such rather than pretending it is active.
 *
 * ---------------------------------------------------------------------------
 * WHAT A RUN MAY WRITE
 * ---------------------------------------------------------------------------
 *
 * **Never an amount, a currency, a rate or a date.** The eight action kinds cover a category, a
 * payee, tags, a note, a payment method and two flags, and `RuleOutcome` has nowhere to put
 * anything else. So a run enqueues **no ledger rebuild** — `runWithLedgerBatch` and
 * `touchLedgerAccount` are deliberately absent from this file, and their appearance here would
 * mean an action started moving money.
 *
 * **A locked payee is not overwritten.** `payee_locked` records that a person overrode the payee;
 * `set_payee` skips such a transaction, in the fold rather than in the write path, so that
 * `14-S2`'s preview shows the same outcome the save will produce.
 *
 * {@link resolveOutcome} is pure — rules, a subject and a trigger in, a decision out — and it is
 * what the preview calls. {@link applyRules} is the effectful half: it loads, folds, writes, and
 * adds up the counters.
 */

import {
  applyOutcome,
  listApplicableRules,
  loadRuleSubjects,
  recordMatches,
} from '#/server/repos/rules'

import { isBookable } from '#/server/booking-rule'

import { evaluateRule } from './evaluate'

import type { Rule, RuleOutcome, RuleSubject } from '#/server/repos/rules'
import type { TenantScope } from '#/server/repos/base'
import type { RuleAction, RuleTrigger } from './schema'

/** What one transaction's fold produced, and which rules produced it. */
export interface ResolvedOutcome {
  readonly outcome: RuleOutcome
  /** In the order they ran. Empty when nothing matched. */
  readonly matchedRuleIds: ReadonlyArray<string>
}

/**
 * Folds the rule set over one transaction.
 *
 * Pure: no scope, no database, and a clock only through `now`. Rules arrive **in the order they run** — the caller owns
 * loading and ordering, this owns deciding — and every later action overwrites the earlier one for
 * the field it names. The `run_on` gate is applied here rather than left to the loader, so a caller
 * that hands over the whole rule set (`14-S2`'s preview does) gets the answer the save path would
 * produce.
 *
 * **A run never settles a row the booking rule would refuse.** For a subject dated after the latest
 * calendar day on Earth, `mark_planned: false` is dropped and the rule's other actions still apply:
 * a run is not transactional, so throwing mid-run would leave the earlier subjects written and the
 * later ones not (`#/server/booking-rule`). The preview calls this too, so it shows what the save
 * will do.
 *
 * A tag is kept as **the last operation naming it**, not as two sets: a rule that adds `#coffee`
 * followed by one that removes it means the tag is removed, and a run that both inserted and
 * deleted the same row would be a run whose result depends on which statement ran last.
 */
export function resolveOutcome(
  orderedRules: ReadonlyArray<Rule>,
  subject: RuleSubject,
  trigger: RuleTrigger,
  now: Date = new Date(),
): ResolvedOutcome {
  const matchedRuleIds: Array<string> = []
  const tagOperations = new Map<string, 'add' | 'remove'>()
  let scalars: Omit<RuleOutcome, 'addTagIds' | 'removeTagIds'> = {}

  for (const rule of orderedRules) {
    if (!rule.runOn.includes(trigger)) continue
    if (!evaluateRule(rule, subject)) continue

    matchedRuleIds.push(rule.id)
    for (const action of rule.actions) {
      scalars = { ...scalars, ...scalarFor(action, subject, now) }
      const tagOperation = tagOperationFor(action)
      if (tagOperation !== null) {
        tagOperations.set(tagOperation.tagId, tagOperation.operation)
      }
    }
  }

  return {
    outcome: {
      ...scalars,
      addTagIds: tagIdsFor(tagOperations, 'add'),
      removeTagIds: tagIdsFor(tagOperations, 'remove'),
    },
    matchedRuleIds,
  }
}

/**
 * The column an action writes, or nothing when it writes a tag.
 *
 * The `switch` has **no `default`**, so a ninth action kind added to `./schema` fails to compile
 * here rather than being silently ignored by a run — the same exhaustiveness the evaluator's
 * condition `switch` relies on, for the same reason.
 */
function scalarFor(
  action: RuleAction,
  subject: RuleSubject,
  now: Date,
): Omit<RuleOutcome, 'addTagIds' | 'removeTagIds'> {
  switch (action.kind) {
    case 'set_category':
      return { categoryId: action.categoryId }
    case 'set_payee':
      // The person overrode this payee; an automation does not change it back.
      return subject.payeeLocked ? {} : { payeeId: action.payeeId }
    case 'set_note':
      return { note: action.note }
    case 'set_payment_method':
      return { paymentMethod: action.paymentMethod }
    case 'mark_planned':
      // Settling is the one action the booking rule can refuse; planning a row is always allowed.
      return action.isPlanned ||
        isBookable({ bookedOn: subject.bookedOn, isPlanned: false }, now)
        ? { isPlanned: action.isPlanned }
        : {}
    case 'set_excluded':
      return { excludeFromStats: action.excludeFromStats }
    case 'add_tag':
    case 'remove_tag':
      return {}
  }
}

function tagOperationFor(
  action: RuleAction,
): { readonly tagId: string; readonly operation: 'add' | 'remove' } | null {
  if (action.kind === 'add_tag') {
    return { tagId: action.tagId, operation: 'add' }
  }
  if (action.kind === 'remove_tag') {
    return { tagId: action.tagId, operation: 'remove' }
  }
  return null
}

function tagIdsFor(
  operations: ReadonlyMap<string, 'add' | 'remove'>,
  wanted: 'add' | 'remove',
): ReadonlyArray<string> {
  return [...operations]
    .filter(([, operation]) => operation === wanted)
    .map(([tagId]) => tagId)
}

/* -------------------------------------------------------------------------- */
/* The effectful half                                                         */
/* -------------------------------------------------------------------------- */

export interface ApplyRulesInput {
  /** The transactions this trigger just wrote. Capped by `MAX_SUBJECTS_PER_RUN`; an import chunks. */
  readonly transactionIds: ReadonlyArray<string>
  readonly trigger: RuleTrigger
}

export interface ApplyRulesResult {
  /** How many of the given transactions existed in this workspace and were evaluated. */
  readonly scannedCount: number
  /** How many of them a rule actually changed. */
  readonly changedCount: number
  /** Rule id → how many transactions it matched in this run. What the counters were told. */
  readonly matchesByRule: ReadonlyMap<string, number>
}

/**
 * Runs the workspace's rules over a set of transactions, once.
 *
 * Two queries' worth of loading for the whole run rather than per row, one pass per transaction,
 * and **one counter statement at the end** — an import of five thousand rows must not produce five
 * thousand counter updates, so the matches are added up here and handed to `recordMatches` as a
 * single batch (`14-S3`'s accounting requirement, met by construction rather than by care).
 *
 * A transaction id that belongs to another workspace simply is not loaded: `loadRuleSubjects` is
 * tenant-scoped, so a foreign id contributes nothing to `scannedCount` and cannot be written to.
 */
export async function applyRules(
  scope: TenantScope,
  input: ApplyRulesInput,
): Promise<ApplyRulesResult> {
  const [orderedRules, subjects] = await Promise.all([
    listApplicableRules(scope, input.trigger),
    loadRuleSubjects(scope, input.transactionIds),
  ])

  const matchesByRule = new Map<string, number>()
  let changedCount = 0

  for (const subject of subjects) {
    const resolved = resolveOutcome(orderedRules, subject, input.trigger)
    if (resolved.matchedRuleIds.length === 0) continue

    for (const ruleId of resolved.matchedRuleIds) {
      matchesByRule.set(ruleId, (matchesByRule.get(ruleId) ?? 0) + 1)
    }
    if (await applyOutcome(scope, subject, resolved.outcome)) changedCount += 1
  }

  await recordMatches(
    scope,
    [...matchesByRule].map(([ruleId, count]) => ({ ruleId, count })),
  )

  return { scannedCount: subjects.length, changedCount, matchesByRule }
}
