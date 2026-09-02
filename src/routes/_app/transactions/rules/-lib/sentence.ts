/**
 * The rule, read back as a sentence.
 *
 * ---------------------------------------------------------------------------
 * WHY A SENTENCE AND NOT SIX DROPDOWNS
 * ---------------------------------------------------------------------------
 *
 * A rule editor is a form whose meaning is not in any one control. Six pickers can each be right
 * and the rule they add up to still be wrong — "the note contains Żabka **or** the amount is over
 * 50 zł" is a different rule from the same six controls under `all`, and nothing on the screen says
 * so unless something says it in words. So the editor renders
 *
 * > _When the note contains "Żabka" and the amount is over 50,00 zł, set the category to Groceries._
 *
 * above the controls, live, and the person verifies **meaning** rather than assembling it.
 *
 * ---------------------------------------------------------------------------
 * THE THREE RULES THIS MODULE KEEPS
 * ---------------------------------------------------------------------------
 *
 * 1. **Every fragment is a catalogue key, and the key is looked up in a table, never built.**
 *    `CONDITION_KEY` and `ACTION_KEY` are exhaustive `Record`s over the closed vocabularies, so a
 *    tenth condition field or a ninth action kind is a **compile error here** rather than a
 *    sentence that silently drops a clause. String-concatenating a key would also make the two
 *    catalogues unverifiable by the parity test.
 *
 * 2. **Amounts go through `formatMoney`.** The condition somebody reads is in their locale and
 *    their currency — `50,00 zł`, not `5000`. A raw minor-unit integer in a sentence is the fastest
 *    way to make a person write a rule two decimal places wrong.
 *
 * 3. **An id renders as the name it stands for, and an unknown id says so.** A rule naming a
 *    category that has since been deleted must not read "set the category to cat_01H…"; it reads
 *    the fallback, and `14-S3`'s banner is what explains why.
 *
 * The renderer takes **parsed** conditions and actions, not editor drafts, so a half-filled row
 * contributes nothing rather than an ungrammatical fragment. `-lib/draft.ts` owns that filtering.
 */

import { formatMoney, makeMoney } from '#/lib/money'
import { PAYMENT_METHOD_KEY } from '#/components/app/transactions'

import type { Locale, MessageKey, Translate } from '#/lib/i18n'
import type {
  RuleAction,
  RuleCondition,
  RuleMatchMode,
} from '#/server/rules/schema'

/** `id → name` for each vocabulary a condition or action can name. */
export interface SentenceNames {
  readonly accounts: ReadonlyMap<string, string>
  readonly accountGroups: ReadonlyMap<string, string>
  readonly categories: ReadonlyMap<string, string>
  readonly tags: ReadonlyMap<string, string>
  readonly payees: ReadonlyMap<string, string>
}

export interface SentenceContext {
  readonly t: Translate
  readonly locale: Locale
  readonly names: SentenceNames
}

/* -------------------------------------------------------------------------- */
/* The key tables                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One key per (field, operator) pair the schema allows — twenty-two of them.
 *
 * Spelled out rather than composed from a field key and an operator key, because "the note does not
 * contain" and "the account is not" are not the same negation in Polish and would not be one key
 * with a slot in it. A translator needs the whole clause.
 */
const CONDITION_KEY: Readonly<Record<string, MessageKey>> = {
  'note.contains': 'rules.clause.note.contains',
  'note.not_contains': 'rules.clause.note.notContains',
  'payee.contains': 'rules.clause.payee.contains',
  'payee.not_contains': 'rules.clause.payee.notContains',
  'account.is_any_of': 'rules.clause.account.isAnyOf',
  'account.is_none_of': 'rules.clause.account.isNoneOf',
  'account_group.is_any_of': 'rules.clause.accountGroup.isAnyOf',
  'account_group.is_none_of': 'rules.clause.accountGroup.isNoneOf',
  'category.is_any_of': 'rules.clause.category.isAnyOf',
  'category.is_none_of': 'rules.clause.category.isNoneOf',
  'tag.is_any_of': 'rules.clause.tag.isAnyOf',
  'tag.is_none_of': 'rules.clause.tag.isNoneOf',
  'day_of_month.is_any_of': 'rules.clause.dayOfMonth.isAnyOf',
  'day_of_month.is_none_of': 'rules.clause.dayOfMonth.isNoneOf',
  'amount.eq': 'rules.clause.amount.eq',
  'amount.gt': 'rules.clause.amount.gt',
  'amount.gte': 'rules.clause.amount.gte',
  'amount.lt': 'rules.clause.amount.lt',
  'amount.lte': 'rules.clause.amount.lte',
  'direction.income': 'rules.clause.direction.income',
  'direction.expense': 'rules.clause.direction.expense',
}

/** One key per action kind, and two apiece for the pair that carry a boolean. */
const ACTION_KEY: Readonly<Record<string, MessageKey>> = {
  set_category: 'rules.clause.setCategory',
  set_payee: 'rules.clause.setPayee',
  add_tag: 'rules.clause.addTag',
  remove_tag: 'rules.clause.removeTag',
  set_note: 'rules.clause.setNote',
  set_payment_method: 'rules.clause.setPaymentMethod',
  'mark_planned.true': 'rules.clause.markPlanned',
  'mark_planned.false': 'rules.clause.markNotPlanned',
  'set_excluded.true': 'rules.clause.exclude',
  'set_excluded.false': 'rules.clause.include',
}

/* -------------------------------------------------------------------------- */
/* Clauses                                                                    */
/* -------------------------------------------------------------------------- */

/** The comma-and-space a list of keywords, ids or days is joined with. */
function joinValues(
  context: SentenceContext,
  parts: ReadonlyArray<string>,
): string {
  return parts.join(context.t('rules.sentence.listSeparator'))
}

function nameOf(
  context: SentenceContext,
  index: ReadonlyMap<string, string>,
  id: string,
): string {
  return index.get(id) ?? context.t('rules.sentence.unknownReference')
}

function money(context: SentenceContext, minor: number, code: string): string {
  return formatMoney(context.locale, makeMoney(minor, code))
}

/** One condition, as a clause. Exhaustive over the nine fields by construction. */
export function conditionClause(
  condition: RuleCondition,
  context: SentenceContext,
): string {
  const { t, names } = context

  switch (condition.field) {
    case 'note':
    case 'payee':
      return t(CONDITION_KEY[`${condition.field}.${condition.operator}`], {
        values: joinValues(
          context,
          condition.keywords.map((keyword) =>
            t('rules.sentence.quoted', { value: keyword }),
          ),
        ),
      })
    case 'account':
      return t(CONDITION_KEY[`account.${condition.operator}`], {
        values: joinValues(
          context,
          condition.ids.map((id) => nameOf(context, names.accounts, id)),
        ),
      })
    case 'account_group':
      return t(CONDITION_KEY[`account_group.${condition.operator}`], {
        values: joinValues(
          context,
          condition.ids.map((id) => nameOf(context, names.accountGroups, id)),
        ),
      })
    case 'category':
      return t(CONDITION_KEY[`category.${condition.operator}`], {
        values: joinValues(
          context,
          condition.ids.map((id) => nameOf(context, names.categories, id)),
        ),
      })
    case 'tag':
      return t(CONDITION_KEY[`tag.${condition.operator}`], {
        values: joinValues(
          context,
          condition.ids.map((id) => nameOf(context, names.tags, id)),
        ),
      })
    case 'day_of_month':
      return t(CONDITION_KEY[`day_of_month.${condition.operator}`], {
        values: joinValues(
          context,
          condition.days.map((day) => String(day)),
        ),
      })
    case 'amount':
      return t(CONDITION_KEY[`amount.${condition.operator}`], {
        amount: money(context, condition.amountMinor, condition.currencyCode),
      })
    case 'direction':
      return t(CONDITION_KEY[`direction.${condition.direction}`])
  }
}

/** One action, as a clause. Exhaustive over the eight kinds. */
export function actionClause(
  action: RuleAction,
  context: SentenceContext,
): string {
  const { t, names } = context

  switch (action.kind) {
    case 'set_category':
      return t(ACTION_KEY.set_category, {
        value: nameOf(context, names.categories, action.categoryId),
      })
    case 'set_payee':
      return t(ACTION_KEY.set_payee, {
        value: nameOf(context, names.payees, action.payeeId),
      })
    case 'add_tag':
      return t(ACTION_KEY.add_tag, {
        value: nameOf(context, names.tags, action.tagId),
      })
    case 'remove_tag':
      return t(ACTION_KEY.remove_tag, {
        value: nameOf(context, names.tags, action.tagId),
      })
    case 'set_note':
      return t(ACTION_KEY.set_note, { value: action.note })
    case 'set_payment_method':
      return t(ACTION_KEY.set_payment_method, {
        value: t(PAYMENT_METHOD_KEY[action.paymentMethod]),
      })
    case 'mark_planned':
      return t(ACTION_KEY[`mark_planned.${String(action.isPlanned)}`])
    case 'set_excluded':
      return t(ACTION_KEY[`set_excluded.${String(action.excludeFromStats)}`])
  }
}

/* -------------------------------------------------------------------------- */
/* The sentence                                                               */
/* -------------------------------------------------------------------------- */

export interface RuleSentenceInput {
  readonly matchMode: RuleMatchMode
  readonly conditions: ReadonlyArray<RuleCondition>
  readonly actions: ReadonlyArray<RuleAction>
}

/**
 * The whole rule in one sentence, or the honest placeholder while it is not yet a rule.
 *
 * The two incomplete states are named separately rather than collapsed into "incomplete", because
 * they call for different next actions: a rule with no condition needs a condition, and a rule with
 * conditions and no action needs an action. A single "finish the rule" would leave the person
 * hunting for which half.
 */
export function ruleSentence(
  input: RuleSentenceInput,
  context: SentenceContext,
): string {
  const { t } = context

  if (input.conditions.length === 0) return t('rules.sentence.noConditions')
  if (input.actions.length === 0) return t('rules.sentence.noActions')

  const separator = t(
    input.matchMode === 'all' ? 'rules.sentence.and' : 'rules.sentence.or',
  )

  return t('rules.sentence.template', {
    when: input.conditions
      .map((condition) => conditionClause(condition, context))
      .join(separator),
    then: input.actions
      .map((action) => actionClause(action, context))
      .join(t('rules.sentence.and')),
  })
}
