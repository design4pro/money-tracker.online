/**
 * The rule DSL: what a condition is, what an action is, and every ceiling the engine stands on.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **The condition field list is closed at nine** — `note`, `payee`, `account`, `account_group`,
 *    `amount`, `direction`, `day_of_month`, `tag`, `category` — and the action list at eight. Both
 *    are modelled as **discriminated unions**, so `#/server/rules/evaluate` can `switch` over them
 *    with no `default` and a tenth member becomes a compile error rather than a silent no-match. A
 *    tenth field is a schema change and a migration, not a JSON addition somebody ships on a
 *    Friday. (`bank_connection` is absent and stays absent: there are no connectors, ever —
 *    `docs/adr/0008-no-bank-connectors.md`.)
 *
 * 2. **Every ceiling is expressed here, in Zod.** 100 rules, 10 conditions per rule, 20 keywords of
 *    64 characters, 20 ids per id-condition, 4 actions, a 200-character note. A limit enforced in
 *    the editor and not in the schema is not a limit — the editor is one caller of five (the seed,
 *    the importer, the preview and a future API are the others), and a rule engine with no
 *    ceilings turns one import into a quadratic evaluation.
 *
 * 3. **A rule with no conditions is refused, never accepted as "matches everything".** `min(1)` on
 *    the condition list is the whole of it: an empty `all` array is vacuously true in every
 *    reasonable reading, which would silently turn a half-finished rule into an apply-to-every-row
 *    switch nobody asked for. The same `min(1)` on actions: a rule that does nothing is a rule
 *    somebody will one day debug.
 *
 * 4. **An amount condition carries the currency it was written in.** Comparing across currencies
 *    without a rate is wrong, and comparing with one makes a rule's behaviour depend on the day it
 *    runs. The column is therefore part of the condition, and the evaluator refuses the comparison
 *    rather than converting. See `#/server/rules/evaluate`.
 *
 * The stored JSON is read back through {@link readConditions}, {@link readActions} and
 * {@link readRunOn}, which answer the **empty list** for a blob this version cannot parse. That
 * direction is chosen deliberately: an unreadable condition list must mean "matches nothing", never
 * "matches everything", and an unreadable action list must mean "does nothing".
 */

import { z } from 'zod'

import { MAX_MINOR } from '#/lib/money'
// From the enum module, not the table schema: this file is imported by the rule editor in the
// browser, and the schema module would bring every table and drizzle-orm with it.
import {
  PAYMENT_METHODS,
  RULE_MATCH_MODES,
  TRANSACTION_DIRECTIONS,
} from '#/lib/enums'

/* -------------------------------------------------------------------------- */
/* The ceilings                                                               */
/* -------------------------------------------------------------------------- */

/** How many rules one workspace may hold. Enforced as a quota in `repos/rules`. */
export const MAX_RULES_PER_WORKSPACE = 100
/** Conditions per rule. Ten `AND`ed predicates is already more than a person can hold. */
export const MAX_CONDITIONS_PER_RULE = 10
/** Keywords in one text condition. */
export const MAX_KEYWORDS_PER_CONDITION = 20
/** Characters in one keyword. Longer than any merchant string a bank export carries. */
export const MAX_KEYWORD_LENGTH = 64
/** Ids in one id-condition — accounts, groups, categories or tags. */
export const MAX_IDS_PER_CONDITION = 20
/** Actions per rule. Four is every field a rule may write, once each. */
export const MAX_ACTIONS_PER_RULE = 4
/** Characters a `set_note` action may write. The column holds 500; a rule may spend 200. */
export const MAX_ACTION_NOTE_LENGTH = 200

/* -------------------------------------------------------------------------- */
/* The closed vocabularies                                                    */
/* -------------------------------------------------------------------------- */

/** The nine, and there is no tenth without a migration. */
export const RULE_CONDITION_FIELDS = [
  'note',
  'payee',
  'account',
  'account_group',
  'amount',
  'direction',
  'day_of_month',
  'tag',
  'category',
] as const
export type RuleConditionField = (typeof RULE_CONDITION_FIELDS)[number]

/** The eight. Closed precisely so that **no action can change an amount** — see `./apply`. */
export const RULE_ACTION_KINDS = [
  'set_category',
  'set_payee',
  'add_tag',
  'remove_tag',
  'set_note',
  'set_payment_method',
  'mark_planned',
  'set_excluded',
] as const
export type RuleActionKind = (typeof RULE_ACTION_KINDS)[number]

/** Which write paths evaluate a rule. A rule with none of them is inert, and says so. */
export const RULE_TRIGGERS = ['manual_create', 'import', 'edit'] as const
export type RuleTrigger = (typeof RULE_TRIGGERS)[number]

/* -------------------------------------------------------------------------- */
/* Condition primitives                                                       */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(64)

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/u, { error: 'An ISO 4217 alphabetic code.' })

/** 1–20 keywords of at most 64 characters. Both halves of the limit, in one place. */
const keywordsSchema = z
  .array(z.string().trim().min(1).max(MAX_KEYWORD_LENGTH))
  .min(1)
  .max(MAX_KEYWORDS_PER_CONDITION)

/** 1–20 ids. The same ceiling for accounts, groups, categories and tags: they are one shape. */
const idsSchema = z.array(idSchema).min(1).max(MAX_IDS_PER_CONDITION)

/** What a text condition asks of the keywords. Both directions, because "not from Uber" is real. */
const textOperatorSchema = z.enum(['contains', 'not_contains'])

/** What an id or day condition asks of its list. */
const setOperatorSchema = z.enum(['is_any_of', 'is_none_of'])

/**
 * What an amount condition asks.
 *
 * No `between`: a range is two conditions in `all` mode, which the editor can render and which
 * needs no second value on the condition, no ordering check between the two and no second
 * inclusive/exclusive story. Every operator here is **inclusive where it says so** — `gte 10000`
 * matches exactly `10000` — and `evaluate.test.ts` pins that boundary, because the editor's copy
 * and the evaluator have to agree about it.
 */
const amountOperatorSchema = z.enum(['eq', 'gt', 'gte', 'lt', 'lte'])

/* -------------------------------------------------------------------------- */
/* Conditions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One condition, discriminated on `field`.
 *
 * Every member is a `strictObject`, so a payload carrying a field this version does not know is
 * refused rather than ignored — a condition that half-parsed is a rule that matches something
 * other than what somebody wrote.
 */
export const ruleConditionSchema = z.discriminatedUnion('field', [
  /** Matched against the transaction's note, normalised. See `./evaluate`. */
  z.strictObject({
    field: z.literal('note'),
    operator: textOperatorSchema,
    keywords: keywordsSchema,
  }),
  /** Matched against the payee's **name**, normalised — not against the payee id. */
  z.strictObject({
    field: z.literal('payee'),
    operator: textOperatorSchema,
    keywords: keywordsSchema,
  }),
  z.strictObject({
    field: z.literal('account'),
    operator: setOperatorSchema,
    ids: idsSchema,
  }),
  z.strictObject({
    field: z.literal('account_group'),
    operator: setOperatorSchema,
    ids: idsSchema,
  }),
  z.strictObject({
    field: z.literal('category'),
    operator: setOperatorSchema,
    ids: idsSchema,
  }),
  z.strictObject({
    field: z.literal('tag'),
    operator: setOperatorSchema,
    ids: idsSchema,
  }),
  /**
   * An integer count of minor units **in the currency named beside it**.
   *
   * Non-negative because `amount_minor` is: the sign of a transaction is its `direction`, and a
   * rule that wanted "money leaving" says `direction`, not a negative number.
   */
  z.strictObject({
    field: z.literal('amount'),
    operator: amountOperatorSchema,
    amountMinor: z.number().int().min(0).max(MAX_MINOR),
    currencyCode: currencySchema,
  }),
  /**
   * Income or expense.
   *
   * No operator: with exactly two directions, "is not income" is "is expense", and a second
   * spelling of one condition is what makes a rule list hard to read back.
   */
  z.strictObject({
    field: z.literal('direction'),
    direction: z.enum(TRANSACTION_DIRECTIONS),
  }),
  /**
   * The day of `booked_on`, 1–31.
   *
   * A list rather than a range, because "the 1st and the 15th" is the shape a salary or a rent day
   * actually has. A month with 30 days simply never matches a `31` — stated rather than clamped,
   * because clamping would make a rule fire on the 30th of April that its author did not write.
   */
  z.strictObject({
    field: z.literal('day_of_month'),
    operator: setOperatorSchema,
    days: z.array(z.number().int().min(1).max(31)).min(1).max(31),
  }),
])
export type RuleCondition = z.infer<typeof ruleConditionSchema>

export const ruleConditionsSchema = z
  .array(ruleConditionSchema)
  .min(1)
  .max(MAX_CONDITIONS_PER_RULE)

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One action, discriminated on `kind`.
 *
 * **Not one of these touches an amount, a currency, a rate or a date**, and that is the property
 * that lets a rule run skip the ledger batch entirely (`docs/plans/14-rules.md`, Ledger batching).
 * An action that could move money would need a rebuild enqueued and a different review.
 */
export const ruleActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('set_category'), categoryId: idSchema }),
  z.strictObject({ kind: z.literal('set_payee'), payeeId: idSchema }),
  z.strictObject({ kind: z.literal('add_tag'), tagId: idSchema }),
  z.strictObject({ kind: z.literal('remove_tag'), tagId: idSchema }),
  z.strictObject({
    kind: z.literal('set_note'),
    note: z.string().trim().min(1).max(MAX_ACTION_NOTE_LENGTH),
  }),
  z.strictObject({
    kind: z.literal('set_payment_method'),
    paymentMethod: z.enum(PAYMENT_METHODS),
  }),
  /** Both directions, so a rule can un-plan a row it planned. */
  z.strictObject({ kind: z.literal('mark_planned'), isPlanned: z.boolean() }),
  z.strictObject({
    kind: z.literal('set_excluded'),
    excludeFromStats: z.boolean(),
  }),
])
export type RuleAction = z.infer<typeof ruleActionSchema>

export const ruleActionsSchema = z
  .array(ruleActionSchema)
  .min(1)
  .max(MAX_ACTIONS_PER_RULE)

/* -------------------------------------------------------------------------- */
/* Triggers and the rule definition                                           */
/* -------------------------------------------------------------------------- */

/**
 * Which triggers evaluate this rule.
 *
 * De-duplicated on the way in, so `['import', 'import']` is stored as one entry: the list is a
 * set, and a stored duplicate would show as two ticks of one checkbox in the editor. An **empty**
 * list is legal and means the rule is inert — the editor says so rather than pretending it is
 * active, which is a truer thing to show than a rule quietly refusing to save.
 */
export const runOnSchema = z
  .array(z.enum(RULE_TRIGGERS))
  .max(RULE_TRIGGERS.length)
  .transform((triggers) => [...new Set(triggers)])

/** Whether every condition must hold, or any one of them. Mirrors `rules.match_mode`. */
export const ruleMatchModeSchema = z.enum(RULE_MATCH_MODES)
export type RuleMatchMode = z.infer<typeof ruleMatchModeSchema>

/**
 * A rule as somebody wrote it — saved or not.
 *
 * `14-S2`'s live preview parses an **unsaved** rule with this exact schema, so the preview cannot
 * evaluate a rule the save path would reject. That is the whole reason it lives here rather than
 * in the repository beside `createRuleSchema`.
 */
export const ruleDefinitionSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  matchMode: ruleMatchModeSchema.default('all'),
  conditions: ruleConditionsSchema,
  actions: ruleActionsSchema,
  runOn: runOnSchema.default(['manual_create', 'import']),
})
export type RuleDefinitionInput = z.input<typeof ruleDefinitionSchema>
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>

/* -------------------------------------------------------------------------- */
/* Reading the stored JSON                                                    */
/* -------------------------------------------------------------------------- */

function readJson(stored: string | null): unknown {
  if (stored === null || stored.trim() === '') return null
  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}

/**
 * The conditions a stored rule carries, or **none**.
 *
 * A blob this version cannot parse answers `[]`, and `evaluateRule` reads an empty condition list
 * as *matches nothing*. Both halves are load-bearing and point the same way: the failure mode of
 * an unreadable rule must be that it stops acting, never that it starts acting on everything.
 */
export function readConditions(
  stored: string | null,
): ReadonlyArray<RuleCondition> {
  const parsed = ruleConditionsSchema.safeParse(readJson(stored))
  return parsed.success ? parsed.data : []
}

/** The actions a stored rule carries, or none. An unreadable action list does nothing. */
export function readActions(stored: string | null): ReadonlyArray<RuleAction> {
  const parsed = ruleActionsSchema.safeParse(readJson(stored))
  return parsed.success ? parsed.data : []
}

/** The triggers a stored rule runs on, or none — which makes the rule inert. */
export function readRunOn(stored: string | null): ReadonlyArray<RuleTrigger> {
  const parsed = runOnSchema.safeParse(readJson(stored))
  return parsed.success ? parsed.data : []
}
