/**
 * What the editor holds while somebody is still typing, and how it becomes a rule.
 *
 * ---------------------------------------------------------------------------
 * WHY A DRAFT IS NOT A `RuleCondition`
 * ---------------------------------------------------------------------------
 *
 * `#/server/rules/schema` is deliberately strict: a text condition has **at least one** keyword, an
 * id condition at least one id, an amount condition an integer and a currency. A half-filled row is
 * therefore not a `RuleCondition` and cannot be stored as one — but it is exactly what an editor
 * holds for the second between adding a row and filling it in. The draft is that intermediate
 * state, and {@link toCondition} is the one narrow place it is turned into the closed vocabulary.
 *
 * A draft carries **every** field rather than being a nine-member union, and that is a considered
 * trade. Switching the field picker must not lose what was typed — somebody who picks `payee`,
 * types two keywords and then realises they meant `note` keeps them — and a union would have to
 * either discard the other branches or carry them anyway in a side table. One flat record, and
 * `toCondition` reads only the members the chosen field uses.
 *
 * ---------------------------------------------------------------------------
 * THE OPERATOR VOCABULARY IS CLOSED PER **TYPE**, NOT PER FIELD
 * ---------------------------------------------------------------------------
 *
 * Nine fields, four shapes. {@link conditionShapeOf} is the mapping, and it is what lets one row
 * component render all nine without a nine-way switch in JSX:
 *
 * | shape    | fields                                | operators                       |
 * | -------- | ------------------------------------- | ------------------------------- |
 * | `text`   | `note`, `payee`                       | `contains`, `not_contains`      |
 * | `ids`    | `account`, `account_group`, `category`, `tag` | `is_any_of`, `is_none_of` |
 * | `days`   | `day_of_month`                        | `is_any_of`, `is_none_of`       |
 * | `amount` | `amount`                              | `eq`, `gt`, `gte`, `lt`, `lte`  |
 * | `enum`   | `direction`                           | **none**                        |
 *
 * `direction` has no operator because with exactly two directions "is not income" is a second
 * spelling of "is expense", and two spellings of one condition is what makes a rule list hard to
 * read back. The editor renders no operator control for it at all rather than a disabled one.
 *
 * ---------------------------------------------------------------------------
 * "BETWEEN" IS TWO CONDITIONS, NOT A SIXTH OPERATOR
 * ---------------------------------------------------------------------------
 *
 * There is no `between` in the schema, on purpose: a two-operand operator needs a second value on
 * the condition, an ordering check between the two and its own inclusive/exclusive story.
 * {@link amountRangeDrafts} gives the person the affordance anyway — one press appends a `gte` row
 * and an `lte` row — so the convenience is in the editor and the vocabulary stays at five.
 *
 * It only means a range under `match_mode: 'all'`. Under `any` those two rows read "at least 10 **or**
 * at most 50", which is every amount there is; the editor refuses the affordance there rather than
 * producing a rule that means something other than what the button said.
 */

import type { Minor } from '#/lib/money'
import type { PaymentMethod, TransactionDirection } from '#/server/db/schema'
import type {
  RuleAction,
  RuleActionKind,
  RuleCondition,
  RuleConditionField,
} from '#/server/rules/schema'

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

/** The five control layouts a condition row can take. Four fields carry an operator, one none. */
export type ConditionShape = 'text' | 'ids' | 'days' | 'amount' | 'enum'

/** Which shape each of the nine fields is rendered as. Exhaustive over the closed list. */
export function conditionShapeOf(field: RuleConditionField): ConditionShape {
  switch (field) {
    case 'note':
    case 'payee':
      return 'text'
    case 'account':
    case 'account_group':
    case 'category':
    case 'tag':
      return 'ids'
    case 'day_of_month':
      return 'days'
    case 'amount':
      return 'amount'
    case 'direction':
      return 'enum'
  }
}

/** The operators offered for a shape, in the order the picker lists them. */
export const OPERATORS_BY_SHAPE = {
  text: ['contains', 'not_contains'],
  ids: ['is_any_of', 'is_none_of'],
  days: ['is_any_of', 'is_none_of'],
  amount: ['eq', 'gt', 'gte', 'lt', 'lte'],
  enum: [],
} as const satisfies Record<ConditionShape, ReadonlyArray<string>>

/** Every operator string the editor can hold, across all four operator-carrying shapes. */
export type DraftOperator =
  (typeof OPERATORS_BY_SHAPE)[ConditionShape][number] extends never
    ? never
    : | 'contains'
      | 'not_contains'
      | 'is_any_of'
      | 'is_none_of'
      | 'eq'
      | 'gt'
      | 'gte'
      | 'lt'
      | 'lte'

/* -------------------------------------------------------------------------- */
/* The drafts                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One condition row, mid-edit.
 *
 * `key` is a client-side identity that survives a reorder or a removal, and is deliberately not the
 * array index: reusing an index makes React keep the box somebody is typing in when the row above
 * it is deleted.
 */
export interface ConditionDraft {
  readonly key: string
  readonly field: RuleConditionField
  readonly operator: DraftOperator
  /** Text shapes. Trimmed and emptied on the way into {@link toCondition}. */
  readonly keywords: ReadonlyArray<string>
  /** Id shapes. */
  readonly ids: ReadonlyArray<string>
  /** The day shape, 1–31. */
  readonly days: ReadonlyArray<number>
  /**
   * The day list exactly as it was typed.
   *
   * Kept beside {@link ConditionDraft.days} so the box does not rewrite itself under somebody's
   * cursor the moment they type a comma. `days` is what the condition means; this is what the
   * person is looking at, and the row reports itself invalid when the two disagree.
   */
  readonly daysText: string
  /** The amount shape: integer minor units, or an empty box. Never a float. */
  readonly amountMinor: Minor | null
  readonly currencyCode: string
  /** The enum shape. */
  readonly direction: TransactionDirection
}

/** One action row, mid-edit. Same reasoning as {@link ConditionDraft} for the flat record. */
export interface ActionDraft {
  readonly key: string
  readonly kind: RuleActionKind
  readonly categoryId: string
  readonly payeeId: string
  readonly tagId: string
  readonly note: string
  readonly paymentMethod: PaymentMethod
  /** `mark_planned` and `set_excluded`. Both directions, so a rule can undo what it did. */
  readonly flag: boolean
}

let nextKey = 0
/** A fresh row identity. Module-level rather than random: it only has to be unique in one editor. */
export function freshKey(): string {
  nextKey += 1
  return `row-${nextKey}`
}

/** The operator a shape starts on — the first one its picker lists. */
export function defaultOperatorFor(field: RuleConditionField): DraftOperator {
  const operators = OPERATORS_BY_SHAPE[conditionShapeOf(field)]
  // `enum` has none; the value is never read for `direction`, and a placeholder keeps the record
  // flat rather than making the whole field optional for one of nine cases.
  return operators[0] ?? 'is_any_of'
}

/** A blank condition row on `field`, in `currencyCode` when it turns out to be an amount. */
export function blankCondition(
  field: RuleConditionField,
  currencyCode: string,
): ConditionDraft {
  return {
    key: freshKey(),
    field,
    operator: defaultOperatorFor(field),
    keywords: [],
    ids: [],
    days: [],
    daysText: '',
    amountMinor: null,
    currencyCode,
    direction: 'expense',
  }
}

/** A blank action row on `kind`. */
export function blankAction(kind: RuleActionKind): ActionDraft {
  return {
    key: freshKey(),
    kind,
    categoryId: '',
    payeeId: '',
    tagId: '',
    note: '',
    paymentMethod: 'card',
    flag: true,
  }
}

/**
 * The two rows a "between" press appends: at least `fromMinor`, at most `toMinor`.
 *
 * Both are ordinary conditions the schema already accepts. The caller decides whether the
 * affordance is offered at all — see the module docblock on `match_mode`.
 */
export function amountRangeDrafts(
  currencyCode: string,
  fromMinor: Minor | null = null,
  toMinor: Minor | null = null,
): ReadonlyArray<ConditionDraft> {
  const base = blankCondition('amount', currencyCode)
  return [
    { ...base, key: freshKey(), operator: 'gte', amountMinor: fromMinor },
    { ...base, key: freshKey(), operator: 'lte', amountMinor: toMinor },
  ]
}

/* -------------------------------------------------------------------------- */
/* Draft → the closed vocabulary                                              */
/* -------------------------------------------------------------------------- */

/**
 * The condition a draft expresses, or `null` while it is still incomplete.
 *
 * `null` is not an error state the person is scolded with — it is simply a row the preview does not
 * evaluate and the sentence does not read out yet. The **save** path is where incompleteness
 * becomes a refusal, and it refuses through `ruleDefinitionSchema` rather than through a second
 * opinion written here.
 */
export function toCondition(draft: ConditionDraft): RuleCondition | null {
  switch (draft.field) {
    case 'note':
    case 'payee': {
      const keywords = draft.keywords
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword !== '')
      if (keywords.length === 0) return null
      return {
        field: draft.field,
        operator:
          draft.operator === 'not_contains' ? 'not_contains' : 'contains',
        keywords,
      }
    }
    case 'account':
    case 'account_group':
    case 'category':
    case 'tag': {
      const ids = [...new Set(draft.ids.filter((id) => id !== ''))]
      if (ids.length === 0) return null
      return { field: draft.field, operator: setOperator(draft.operator), ids }
    }
    case 'day_of_month': {
      const days = [...new Set(draft.days)].sort((a, b) => a - b)
      if (days.length === 0) return null
      return {
        field: 'day_of_month',
        operator: setOperator(draft.operator),
        days,
      }
    }
    case 'amount': {
      if (draft.amountMinor === null) return null
      if (draft.currencyCode.trim() === '') return null
      return {
        field: 'amount',
        operator: amountOperator(draft.operator),
        amountMinor: draft.amountMinor,
        currencyCode: draft.currencyCode.trim().toUpperCase(),
      }
    }
    case 'direction':
      return { field: 'direction', direction: draft.direction }
  }
}

function setOperator(operator: DraftOperator): 'is_any_of' | 'is_none_of' {
  return operator === 'is_none_of' ? 'is_none_of' : 'is_any_of'
}

function amountOperator(
  operator: DraftOperator,
): 'eq' | 'gt' | 'gte' | 'lt' | 'lte' {
  switch (operator) {
    case 'eq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return operator
    default:
      // Reached only by switching a text or id row onto `amount`, which carries its old operator
      // for one render. `gte` is the neutral reading of "an amount", not a guess at intent.
      return 'gte'
  }
}

/** The action a draft expresses, or `null` while its one required value is still empty. */
export function toAction(draft: ActionDraft): RuleAction | null {
  switch (draft.kind) {
    case 'set_category':
      return draft.categoryId === ''
        ? null
        : { kind: 'set_category', categoryId: draft.categoryId }
    case 'set_payee':
      return draft.payeeId === ''
        ? null
        : { kind: 'set_payee', payeeId: draft.payeeId }
    case 'add_tag':
      return draft.tagId === '' ? null : { kind: 'add_tag', tagId: draft.tagId }
    case 'remove_tag':
      return draft.tagId === ''
        ? null
        : { kind: 'remove_tag', tagId: draft.tagId }
    case 'set_note': {
      const note = draft.note.trim()
      return note === '' ? null : { kind: 'set_note', note }
    }
    case 'set_payment_method':
      return { kind: 'set_payment_method', paymentMethod: draft.paymentMethod }
    case 'mark_planned':
      return { kind: 'mark_planned', isPlanned: draft.flag }
    case 'set_excluded':
      return { kind: 'set_excluded', excludeFromStats: draft.flag }
  }
}

/** Every complete condition in the list, in order. Incomplete rows are skipped, not rejected. */
export function conditionsOf(
  drafts: ReadonlyArray<ConditionDraft>,
): ReadonlyArray<RuleCondition> {
  return drafts
    .map(toCondition)
    .filter((condition): condition is RuleCondition => condition !== null)
}

/** Every complete action in the list, in order. */
export function actionsOf(
  drafts: ReadonlyArray<ActionDraft>,
): ReadonlyArray<RuleAction> {
  return drafts
    .map(toAction)
    .filter((action): action is RuleAction => action !== null)
}

/* -------------------------------------------------------------------------- */
/* Stored rule → drafts                                                       */
/* -------------------------------------------------------------------------- */

/** A stored condition, opened for editing. The inverse of {@link toCondition}. */
export function conditionDraftFrom(
  condition: RuleCondition,
  currencyCode: string,
): ConditionDraft {
  const base = blankCondition(condition.field, currencyCode)
  switch (condition.field) {
    case 'note':
    case 'payee':
      return {
        ...base,
        operator: condition.operator,
        keywords: condition.keywords,
      }
    case 'account':
    case 'account_group':
    case 'category':
    case 'tag':
      return { ...base, operator: condition.operator, ids: condition.ids }
    case 'day_of_month':
      return {
        ...base,
        operator: condition.operator,
        days: condition.days,
        daysText: condition.days.join(', '),
      }
    case 'amount':
      return {
        ...base,
        operator: condition.operator,
        amountMinor: condition.amountMinor as Minor,
        currencyCode: condition.currencyCode,
      }
    case 'direction':
      return { ...base, direction: condition.direction }
  }
}

/** A stored action, opened for editing. The inverse of {@link toAction}. */
export function actionDraftFrom(action: RuleAction): ActionDraft {
  const base = blankAction(action.kind)
  switch (action.kind) {
    case 'set_category':
      return { ...base, categoryId: action.categoryId }
    case 'set_payee':
      return { ...base, payeeId: action.payeeId }
    case 'add_tag':
    case 'remove_tag':
      return { ...base, tagId: action.tagId }
    case 'set_note':
      return { ...base, note: action.note }
    case 'set_payment_method':
      return { ...base, paymentMethod: action.paymentMethod }
    case 'mark_planned':
      return { ...base, flag: action.isPlanned }
    case 'set_excluded':
      return { ...base, flag: action.excludeFromStats }
  }
}
