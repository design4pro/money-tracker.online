import { describe, expect, it } from 'vitest'

import { createTranslator } from '#/lib/i18n'
import { asMinor, formatMoney, makeMoney } from '#/lib/money'
import En from '#/lib/i18n/messages/en'
import Pl from '#/lib/i18n/messages/pl'
import { RULE_ACTION_KINDS, RULE_CONDITION_FIELDS } from '#/server/rules/schema'

import { actionClause, conditionClause, ruleSentence } from '../sentence'

import type { Locale } from '#/lib/i18n'
import type { RuleAction, RuleCondition } from '#/server/rules/schema'
import type { SentenceContext } from '../sentence'

/**
 * The sentence is the editor's only statement of what a rule *means*, so these cases are
 * exhaustive rather than illustrative.
 *
 * Two properties, and the second is the one that catches a real bug: every condition field and
 * every action kind renders **in both locales**, and no rendering leaves a `{token}` behind. A
 * missing key returns the key itself and a missing placeholder is left verbatim (`lib/i18n`), so a
 * clause that failed to render looks like copy until somebody reads it — which is exactly what
 * shipped Polish half-translated once before.
 */

const NAMES: SentenceContext['names'] = {
  accounts: new Map([['acc-1', 'Everyday']]),
  accountGroups: new Map([['grp-1', 'Household']]),
  categories: new Map([['cat-1', 'Groceries']]),
  tags: new Map([['tag-1', 'Subscription']]),
  payees: new Map([['pay-1', 'Żabka']]),
}

function contextFor(locale: Locale): SentenceContext {
  return {
    locale,
    t: createTranslator(locale, locale === 'pl' ? Pl : En),
    names: NAMES,
  }
}

/** One condition per field, in both operator directions where the field has operators. */
const CONDITIONS: ReadonlyArray<RuleCondition> = [
  { field: 'note', operator: 'contains', keywords: ['Żabka', 'Lidl'] },
  { field: 'note', operator: 'not_contains', keywords: ['Uber'] },
  { field: 'payee', operator: 'contains', keywords: ['Żabka'] },
  { field: 'payee', operator: 'not_contains', keywords: ['Uber'] },
  { field: 'account', operator: 'is_any_of', ids: ['acc-1'] },
  { field: 'account', operator: 'is_none_of', ids: ['acc-1'] },
  { field: 'account_group', operator: 'is_any_of', ids: ['grp-1'] },
  { field: 'account_group', operator: 'is_none_of', ids: ['grp-1'] },
  { field: 'category', operator: 'is_any_of', ids: ['cat-1'] },
  { field: 'category', operator: 'is_none_of', ids: ['cat-1'] },
  { field: 'tag', operator: 'is_any_of', ids: ['tag-1'] },
  { field: 'tag', operator: 'is_none_of', ids: ['tag-1'] },
  { field: 'day_of_month', operator: 'is_any_of', days: [1, 15] },
  { field: 'day_of_month', operator: 'is_none_of', days: [31] },
  { field: 'amount', operator: 'eq', amountMinor: 5_000, currencyCode: 'PLN' },
  { field: 'amount', operator: 'gt', amountMinor: 5_000, currencyCode: 'PLN' },
  { field: 'amount', operator: 'gte', amountMinor: 5_000, currencyCode: 'PLN' },
  { field: 'amount', operator: 'lt', amountMinor: 5_000, currencyCode: 'PLN' },
  { field: 'amount', operator: 'lte', amountMinor: 5_000, currencyCode: 'PLN' },
  { field: 'direction', direction: 'income' },
  { field: 'direction', direction: 'expense' },
]

const ACTIONS: ReadonlyArray<RuleAction> = [
  { kind: 'set_category', categoryId: 'cat-1' },
  { kind: 'set_payee', payeeId: 'pay-1' },
  { kind: 'add_tag', tagId: 'tag-1' },
  { kind: 'remove_tag', tagId: 'tag-1' },
  { kind: 'set_note', note: 'Weekly shop' },
  { kind: 'set_payment_method', paymentMethod: 'card' },
  { kind: 'mark_planned', isPlanned: true },
  { kind: 'mark_planned', isPlanned: false },
  { kind: 'set_excluded', excludeFromStats: true },
  { kind: 'set_excluded', excludeFromStats: false },
]

const LOCALES: ReadonlyArray<Locale> = ['en', 'pl']

describe('every clause renders, in both locales', () => {
  it('covers all nine condition fields and all eight action kinds', () => {
    // The fixtures are the coverage claim, so they are checked against the closed vocabularies
    // rather than trusted: a tenth field added upstream fails here instead of going unrendered.
    expect(new Set(CONDITIONS.map((c) => c.field))).toEqual(
      new Set(RULE_CONDITION_FIELDS),
    )
    expect(new Set(ACTIONS.map((a) => a.kind))).toEqual(
      new Set(RULE_ACTION_KINDS),
    )
  })

  for (const locale of LOCALES) {
    it(`renders every condition with no key and no token left over — ${locale}`, () => {
      const context = contextFor(locale)
      for (const condition of CONDITIONS) {
        const clause = conditionClause(condition, context)
        expect(clause, JSON.stringify(condition)).not.toMatch(/[{}]/u)
        expect(clause, JSON.stringify(condition)).not.toMatch(/^rules\./u)
        expect(clause.length).toBeGreaterThan(0)
      }
    })

    it(`renders every action with no key and no token left over — ${locale}`, () => {
      const context = contextFor(locale)
      for (const action of ACTIONS) {
        const clause = actionClause(action, context)
        expect(clause, JSON.stringify(action)).not.toMatch(/[{}]/u)
        expect(clause, JSON.stringify(action)).not.toMatch(/^rules\./u)
        expect(clause.length).toBeGreaterThan(0)
      }
    })
  }
})

describe('the whole sentence', () => {
  it('reads the plan’s example back in English', () => {
    expect(
      ruleSentence(
        {
          matchMode: 'all',
          conditions: [
            { field: 'note', operator: 'contains', keywords: ['Żabka'] },
            {
              field: 'amount',
              operator: 'gt',
              amountMinor: 5_000,
              currencyCode: 'PLN',
            },
          ],
          actions: [{ kind: 'set_category', categoryId: 'cat-1' }],
        },
        contextFor('en'),
      ),
    ).toBe(
      // The amount fragment is composed rather than typed: `Intl` separates a currency from its
      // figure with U+00A0, and an assertion carrying a literal space would fail on a character
      // nobody can see. The point of the case is the clause order and the joining word.
      `When the note contains “Żabka” and the amount is over ${formatMoney(
        'en',
        makeMoney(asMinor(5_000), 'PLN'),
      )}, set the category to Groceries.`,
    )
  })

  it('renders an amount through the money formatter, never as minor units', () => {
    const polish = ruleSentence(
      {
        matchMode: 'all',
        conditions: [
          {
            field: 'amount',
            operator: 'gt',
            amountMinor: 5_000,
            currencyCode: 'PLN',
          },
        ],
        actions: [{ kind: 'set_excluded', excludeFromStats: true }],
      },
      contextFor('pl'),
    )
    expect(polish).toContain('50,00')
    expect(polish).not.toContain('5000')
  })

  it('joins with “and” under all, and with “or” under any', () => {
    const both: Parameters<typeof ruleSentence>[0] = {
      matchMode: 'all',
      conditions: [
        { field: 'direction', direction: 'expense' },
        { field: 'day_of_month', operator: 'is_any_of', days: [1] },
      ],
      actions: [{ kind: 'mark_planned', isPlanned: true }],
    }
    expect(ruleSentence(both, contextFor('en'))).toContain(' and ')
    expect(
      ruleSentence({ ...both, matchMode: 'any' }, contextFor('en')),
    ).toContain(' or ')
  })

  it('names an id that no longer resolves rather than printing it', () => {
    const clause = actionClause(
      { kind: 'set_category', categoryId: 'cat-gone' },
      contextFor('en'),
    )
    expect(clause).not.toContain('cat-gone')
    expect(clause).toContain('no longer exists')
  })

  it('says which half is missing rather than “incomplete”', () => {
    const context = contextFor('en')
    expect(
      ruleSentence({ matchMode: 'all', conditions: [], actions: [] }, context),
    ).toBe(En['rules.sentence.noConditions'])
    expect(
      ruleSentence(
        {
          matchMode: 'all',
          conditions: [{ field: 'direction', direction: 'expense' }],
          actions: [],
        },
        context,
      ),
    ).toBe(En['rules.sentence.noActions'])
  })
})
