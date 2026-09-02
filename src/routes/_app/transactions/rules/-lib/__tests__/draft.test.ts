import { describe, expect, it } from 'vitest'

import {
  MAX_CONDITIONS_PER_RULE,
  ruleConditionSchema,
  ruleDefinitionSchema,
} from '#/server/rules/schema'

import {
  actionDraftFrom,
  actionsOf,
  amountRangeDrafts,
  blankAction,
  blankCondition,
  conditionDraftFrom,
  conditionShapeOf,
  conditionsOf,
  toAction,
  toCondition,
} from '../draft'

import type { RuleAction, RuleCondition } from '#/server/rules/schema'

/**
 * The narrow waist between a half-typed form and the closed vocabulary the engine runs.
 *
 * Two things are worth pinning here and nothing else is: **a draft can only ever produce something
 * the schema accepts**, and **opening a stored rule and closing it again changes nothing**. The
 * first is what stops the editor offering a rule the save path would reject; the second is what
 * stops an edit quietly rewriting a condition somebody did not touch.
 */

const STORED: ReadonlyArray<RuleCondition> = [
  { field: 'note', operator: 'contains', keywords: ['zabka', 'lidl'] },
  { field: 'payee', operator: 'not_contains', keywords: ['uber'] },
  { field: 'account', operator: 'is_any_of', ids: ['acc-1', 'acc-2'] },
  { field: 'account_group', operator: 'is_none_of', ids: ['grp-1'] },
  { field: 'category', operator: 'is_any_of', ids: ['cat-1'] },
  { field: 'tag', operator: 'is_none_of', ids: ['tag-1'] },
  { field: 'day_of_month', operator: 'is_any_of', days: [1, 15] },
  { field: 'amount', operator: 'lte', amountMinor: 5_000, currencyCode: 'PLN' },
  { field: 'direction', direction: 'income' },
]

const STORED_ACTIONS: ReadonlyArray<RuleAction> = [
  { kind: 'set_category', categoryId: 'cat-1' },
  { kind: 'set_payee', payeeId: 'pay-1' },
  { kind: 'add_tag', tagId: 'tag-1' },
  { kind: 'remove_tag', tagId: 'tag-2' },
  { kind: 'set_note', note: 'Weekly shop' },
  { kind: 'set_payment_method', paymentMethod: 'transfer' },
  { kind: 'mark_planned', isPlanned: false },
  { kind: 'set_excluded', excludeFromStats: true },
]

describe('opening a stored rule and closing it again', () => {
  it('is the identity on every condition field', () => {
    for (const condition of STORED) {
      expect(toCondition(conditionDraftFrom(condition, 'PLN'))).toEqual(
        condition,
      )
    }
  })

  it('is the identity on every action kind', () => {
    for (const action of STORED_ACTIONS) {
      expect(toAction(actionDraftFrom(action))).toEqual(action)
    }
  })
})

describe('an incomplete row is a row the preview skips, not a rejection', () => {
  it('produces nothing until the shape’s one required value is there', () => {
    expect(toCondition(blankCondition('note', 'PLN'))).toBeNull()
    expect(toCondition(blankCondition('account', 'PLN'))).toBeNull()
    expect(toCondition(blankCondition('day_of_month', 'PLN'))).toBeNull()
    expect(toCondition(blankCondition('amount', 'PLN'))).toBeNull()
    // `direction` has no required value: both directions are legal the moment the row exists.
    expect(toCondition(blankCondition('direction', 'PLN'))).toEqual({
      field: 'direction',
      direction: 'expense',
    })

    expect(toAction(blankAction('set_category'))).toBeNull()
    expect(toAction(blankAction('mark_planned'))).toEqual({
      kind: 'mark_planned',
      isPlanned: true,
    })
  })

  it('drops blank keywords rather than saving one', () => {
    const draft = {
      ...blankCondition('note', 'PLN'),
      keywords: ['  ', 'zabka', ''],
    }
    expect(toCondition(draft)).toEqual({
      field: 'note',
      operator: 'contains',
      keywords: ['zabka'],
    })
  })
})

describe('switching the field carries an operator the new shape allows', () => {
  it('never produces a condition the schema refuses', () => {
    // The one real hazard: a text row switched onto `amount` still holds `contains` for a render.
    const switched = {
      ...blankCondition('note', 'PLN'),
      field: 'amount' as const,
      amountMinor: 5_000 as never,
    }
    const condition = toCondition(switched)
    expect(condition).not.toBeNull()
    expect(ruleConditionSchema.safeParse(condition).success).toBe(true)
  })

  it('rewrites a set operator onto the id shapes', () => {
    expect(conditionShapeOf('category')).toBe('ids')
    const switched = {
      ...blankCondition('amount', 'PLN'),
      field: 'category' as const,
      ids: ['cat-1'],
    }
    expect(toCondition(switched)).toEqual({
      field: 'category',
      operator: 'is_any_of',
      ids: ['cat-1'],
    })
  })
})

describe('the “between” affordance', () => {
  /**
   * The plan asks for the convenience without a sixth operator, and the schema has no `between`.
   * So the button has to produce two conditions the schema already accepts — and this is the case
   * that says it does, by parsing them.
   */
  it('produces exactly two ordinary conditions the schema accepts', () => {
    const drafts = amountRangeDrafts('PLN', 1_000 as never, 5_000 as never)
    expect(drafts).toHaveLength(2)
    expect(drafts.map((draft) => draft.operator)).toEqual(['gte', 'lte'])

    const conditions = conditionsOf(drafts)
    expect(conditions).toEqual([
      {
        field: 'amount',
        operator: 'gte',
        amountMinor: 1_000,
        currencyCode: 'PLN',
      },
      {
        field: 'amount',
        operator: 'lte',
        amountMinor: 5_000,
        currencyCode: 'PLN',
      },
    ])
    for (const condition of conditions) {
      expect(ruleConditionSchema.safeParse(condition).success).toBe(true)
    }
  })

  it('gives the two rows their own identities, so removing one keeps the other', () => {
    const [from, to] = amountRangeDrafts('PLN')
    expect(from.key).not.toBe(to.key)
  })

  it('costs two of the ten conditions a rule may hold', () => {
    const rows = [
      ...Array.from({ length: MAX_CONDITIONS_PER_RULE - 2 }, () =>
        blankCondition('direction', 'PLN'),
      ),
      ...amountRangeDrafts('PLN', 1_000 as never, 5_000 as never),
    ]
    expect(rows).toHaveLength(MAX_CONDITIONS_PER_RULE)
    expect(
      ruleDefinitionSchema.safeParse({
        name: 'Range',
        conditions: conditionsOf(rows),
        actions: actionsOf([blankAction('mark_planned')]),
      }).success,
    ).toBe(true)
  })
})
