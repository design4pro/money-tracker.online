/**
 * Does this rule match this transaction? The whole of the engine's decision, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE IS PURE
 * ---------------------------------------------------------------------------
 *
 * Rules in, a transaction in, a boolean out. No scope, no database, no clock, no `async`. Two
 * consequences, and both are the reason the stage was written this way round:
 *
 * - `14-S2`'s live preview runs it over the last 2 000 transactions on every keystroke. A version
 *   that read a row per condition would be 20 000 queries behind a debounce, which is not a
 *   preview, it is an outage with a spinner.
 * - Every case in `__tests__/evaluate.test.ts` is a fixed input and a fixed answer. Exhaustive
 *   rather than illustrative: there is no fixture to build, so there is no excuse for covering
 *   seven of the nine fields.
 *
 * ---------------------------------------------------------------------------
 * THE THREE RULES THIS MODULE KEEPS
 * ---------------------------------------------------------------------------
 *
 * 1. **The `switch` in {@link matchesCondition} has no `default`.** Every one of the nine fields
 *    returns, so the compiler proves the function returns a `boolean`; a tenth field added to
 *    `./schema` makes this file fail to compile with "lacks ending return statement" rather than
 *    silently falling through to a no-match somebody discovers in production. That exhaustiveness
 *    is the single most important structural decision in the stage, and it is worth knowing that
 *    it rests on the return type rather than on anybody remembering a `never` assertion.
 *
 * 2. **An amount is compared as an integer, in one currency, and never converted.** A condition
 *    written in EUR does not match a PLN transaction — it answers `false`, it does not throw and it
 *    does not reach for a rate. Converting would need a rate on a day nobody chose and would make a
 *    rule's behaviour depend on when it ran; the editor tells the person so (`14-S2`). No float
 *    touches an amount here or anywhere below it: the operators are `<`, `<=`, `===`, `>=`, `>` on
 *    two integers.
 *
 * 3. **Text matching goes through `normalizePayeeName`** — `08-S3`'s one normaliser, not a second
 *    one written here — so a rule written against "Żabka" matches "ZABKA 4471", and so the rule
 *    engine and the payee matcher agree about what two strings being the same means. `docs/SPEC.md`
 *    §8: one concept, one owner.
 *
 * An **empty condition list answers `false`**. It cannot be saved (`./schema` requires one), so it
 * only arises from JSON this version cannot read — and the safe reading of an unreadable rule is
 * that it stops matching, never that it matches everything.
 */

import { normalizePayeeName } from '#/server/repos/payees'

import type { TransactionDirection } from '#/server/db/schema'
import type { RuleCondition, RuleMatchMode } from './schema'

/**
 * The facts a condition is tried against. Deliberately not a database row.
 *
 * Two fields are **resolved by the caller** rather than read off `transactions`: `accountGroupIds`
 * (a join, and a set rather than one id because group membership is many-to-many) and `tagIds` (a
 * second table). `./apply` resolves both once per transaction, before evaluation, so that a hundred
 * rules over one transaction do not resolve them a hundred times — which is the shape that turns
 * an import into a quadratic run.
 */
export interface RuleTarget {
  readonly note: string | null
  /** The payee's display name, not its id. The `payee` condition matches on the name. */
  readonly payeeName: string | null
  readonly accountId: string
  /** Every group the account belongs to — membership is many-to-many, not a parent column. */
  readonly accountGroupIds: ReadonlyArray<string>
  readonly categoryId: string | null
  readonly tagIds: ReadonlyArray<string>
  /** Integer minor units in `currencyCode`, non-negative. The sign is `direction`. */
  readonly amountMinor: number
  readonly currencyCode: string
  readonly direction: TransactionDirection
  /** `YYYY-MM-DD`, a UTC calendar day. The only thing `day_of_month` reads. */
  readonly bookedOn: string
}

/** What the evaluator needs of a rule: how to combine its conditions, and the conditions. */
export interface EvaluableRule {
  readonly matchMode: RuleMatchMode
  readonly conditions: ReadonlyArray<RuleCondition>
}

/**
 * Whether the rule matches, under its own `match_mode`.
 *
 * `all` is `every`, `any` is `some`, and both short-circuit — which is why the cheap conditions
 * being cheap matters: a 5 000-row preview evaluates the first failing condition of most rules and
 * nothing else.
 */
export function evaluateRule(rule: EvaluableRule, target: RuleTarget): boolean {
  if (rule.conditions.length === 0) return false

  return rule.matchMode === 'all'
    ? rule.conditions.every((condition) => matchesCondition(condition, target))
    : rule.conditions.some((condition) => matchesCondition(condition, target))
}

/**
 * One condition against one transaction.
 *
 * Exported because `14-S2`'s editor explains *which* condition failed, and because a per-field
 * test that has to go through `match_mode` to reach a field is a test of two things.
 */
export function matchesCondition(
  condition: RuleCondition,
  target: RuleTarget,
): boolean {
  switch (condition.field) {
    case 'note':
      return matchesKeywords(
        condition.operator,
        condition.keywords,
        target.note,
      )
    case 'payee':
      return matchesKeywords(
        condition.operator,
        condition.keywords,
        target.payeeName,
      )
    case 'account':
      return matchesSet(condition.operator, condition.ids, [target.accountId])
    case 'account_group':
      return matchesSet(
        condition.operator,
        condition.ids,
        target.accountGroupIds,
      )
    case 'category':
      return matchesSet(
        condition.operator,
        condition.ids,
        target.categoryId === null ? [] : [target.categoryId],
      )
    case 'tag':
      return matchesSet(condition.operator, condition.ids, target.tagIds)
    case 'amount':
      return matchesAmount(condition, target)
    case 'direction':
      return target.direction === condition.direction
    // A malformed `booked_on` yields `NaN`, which is in no list and so is in none of them.
    case 'day_of_month':
      return matchesSet(condition.operator, condition.days, [
        dayOfMonth(target.bookedOn),
      ])
  }
}

/* -------------------------------------------------------------------------- */
/* The three comparisons                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Keyword matching, on both sides of `normalizePayeeName`.
 *
 * The haystack and every needle are normalised, so "Żabka" finds "ZABKA 4471" and "carrefour"
 * finds "CARREFOUR MARKET 1234". A `null` or empty haystack contains nothing — which makes
 * `not_contains` **true** for a transaction with no note, and that is the honest answer: a
 * transaction with no note does not contain "Uber".
 */
function matchesKeywords(
  operator: 'contains' | 'not_contains',
  keywords: ReadonlyArray<string>,
  haystack: string | null,
): boolean {
  const normalised = haystack === null ? '' : normaliseOnce(haystack)
  const hit =
    normalised !== '' &&
    keywords.some((keyword) => {
      const needle = normaliseOnce(keyword)
      return needle !== '' && normalised.includes(needle)
    })

  return operator === 'contains' ? hit : !hit
}

/**
 * `normalizePayeeName`, memoised — the one line that makes a 5 000-row preview possible.
 *
 * A run of a hundred rules over five thousand transactions asks for the same normalisation a
 * million times: the same note against every rule, the same keyword against every row.
 * Normalisation is NFD folding plus four regex passes, and measured without this the run takes
 * **8.7 seconds**; with it, the strings are folded once each — five thousand notes and a hundred
 * keywords — and it takes about a tenth of a second. `__tests__/evaluate.test.ts` pins the property
 * rather than the speed: it counts the calls through the module boundary and asserts `R + T`, so the
 * gate reads the same on a laptop and on a two-core runner.
 *
 * The cache is invisible to callers because the function it wraps is deterministic: same string,
 * same answer, forever. It is bounded and cleared wholesale rather than evicted one entry at a
 * time — an isolate serves many workspaces, and the honest ceiling on "how much of other people's
 * text am I holding" is a small number that resets, not an LRU somebody has to reason about.
 */
const NORMALISED_CACHE_LIMIT = 8_192
const normalisedCache = new Map<string, string>()

function normaliseOnce(value: string): string {
  const cached = normalisedCache.get(value)
  if (cached !== undefined) return cached

  const computed = normalizePayeeName(value)
  if (normalisedCache.size >= NORMALISED_CACHE_LIMIT) normalisedCache.clear()
  normalisedCache.set(value, computed)
  return computed
}

/**
 * Set membership, for the four id conditions and for the day list.
 *
 * `values` is what the transaction has — one account, at most one group, at most one category, any
 * number of tags — and the condition holds when the two sets intersect. `is_none_of` is the exact
 * negation, so a transaction with no category *is* "none of these categories". Generic over the
 * member type because the day condition is the same question about numbers, and two copies of one
 * comparison are two chances to fix a bug once.
 */
function matchesSet<T>(
  operator: 'is_any_of' | 'is_none_of',
  wanted: ReadonlyArray<T>,
  values: ReadonlyArray<T>,
): boolean {
  const hit = values.some((value) => wanted.includes(value))
  return operator === 'is_any_of' ? hit : !hit
}

/**
 * The amount comparison: two integers, one currency, no rate.
 *
 * A different currency is **not a match** rather than an error — a workspace holding PLN and EUR
 * rows runs both through the same rule set on every import, and throwing there would fail the
 * import over a rule that simply does not apply to that row.
 */
function matchesAmount(
  condition: Extract<RuleCondition, { field: 'amount' }>,
  target: RuleTarget,
): boolean {
  if (condition.currencyCode !== target.currencyCode) return false

  switch (condition.operator) {
    case 'eq':
      return target.amountMinor === condition.amountMinor
    case 'gt':
      return target.amountMinor > condition.amountMinor
    case 'gte':
      return target.amountMinor >= condition.amountMinor
    case 'lt':
      return target.amountMinor < condition.amountMinor
    case 'lte':
      return target.amountMinor <= condition.amountMinor
  }
}

/** The day of a `YYYY-MM-DD`, as an integer. `NaN` for anything else, which matches nothing. */
function dayOfMonth(bookedOn: string): number {
  return Number(bookedOn.slice(8, 10))
}
