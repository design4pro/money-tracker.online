/**
 * The evaluator, exhaustively — and every ceiling proving that it refuses rather than truncates.
 *
 * No database and no fixture: the module under test is pure, so each case here is a fixed input and
 * a fixed answer. That is what makes "every condition field" a promise rather than an aspiration —
 * all nine are below, in both directions, plus both `match_mode` values, the normalisation path,
 * the cross-currency non-match and the inclusive boundary the editor's copy quotes.
 *
 * The ceiling cases assert two things each, and the second is the one worth writing down: the limit
 * **refuses** the over-sized payload rather than accepting a truncated one. A schema that silently
 * dropped the 21st keyword would be a rule that does not do what its author wrote.
 */

import { describe, expect, it, vi } from 'vitest'

import { evaluateRule, matchesCondition } from '../evaluate'
import {
  MAX_ACTIONS_PER_RULE,
  MAX_ACTION_NOTE_LENGTH,
  MAX_CONDITIONS_PER_RULE,
  MAX_IDS_PER_CONDITION,
  MAX_KEYWORDS_PER_CONDITION,
  MAX_KEYWORD_LENGTH,
  ruleActionsSchema,
  ruleConditionSchema,
  ruleConditionsSchema,
  ruleDefinitionSchema,
} from '../schema'

import type * as PayeesModule from '#/server/repos/payees'
import type { RuleTarget } from '../evaluate'
import type { RuleCondition } from '../schema'

/**
 * The normaliser, counted.
 *
 * `evaluate.ts` memoises `normalizePayeeName` because a run of a hundred rules over five thousand
 * transactions would otherwise fold the same strings a million times. That memo is a **property**,
 * not a speed: normalisation happens once per distinct string, never once per rule × transaction.
 * Wrapping the module boundary is how that property is asserted from outside without a counter in
 * production code — and unlike a wall-clock bound, the assertion says the same thing on a fast
 * laptop and a two-core CI runner. `vi.mock` is hoisted above the imports above it, so the module
 * under test sees the wrapper.
 */
const normalisations = vi.hoisted(() => ({ count: 0 }))
vi.mock('#/server/repos/payees', async (importOriginal) => {
  const actual = await importOriginal<typeof PayeesModule>()
  return {
    ...actual,
    normalizePayeeName: (raw: string) => {
      normalisations.count += 1
      return actual.normalizePayeeName(raw)
    },
  }
})

/** A transaction the whole file starts from: 100,00 PLN at Żabka, on the 10th, uncategorised. */
function target(overrides: Partial<RuleTarget> = {}): RuleTarget {
  return {
    note: 'ZABKA 4471 WARSZAWA',
    payeeName: 'Żabka',
    accountId: 'acc-1',
    accountGroupIds: ['grp-1'],
    categoryId: null,
    tagIds: [],
    amountMinor: 100_00,
    currencyCode: 'PLN',
    direction: 'expense',
    bookedOn: '2026-03-10',
    ...overrides,
  }
}

/** Parsed rather than hand-built, so no case here can assert against a shape the schema refuses. */
function condition(input: unknown): RuleCondition {
  return ruleConditionSchema.parse(input)
}

/* -------------------------------------------------------------------------- */
/* The nine condition fields                                                   */
/* -------------------------------------------------------------------------- */

describe('the nine condition fields', () => {
  it('note — contains and not_contains, over the normalised text', () => {
    const contains = condition({
      field: 'note',
      operator: 'contains',
      keywords: ['żabka'],
    })
    expect(matchesCondition(contains, target())).toBe(true)
    expect(matchesCondition(contains, target({ note: 'Lidl 22' }))).toBe(false)

    const notContains = condition({
      field: 'note',
      operator: 'not_contains',
      keywords: ['żabka'],
    })
    expect(matchesCondition(notContains, target())).toBe(false)
    expect(matchesCondition(notContains, target({ note: null }))).toBe(true)
  })

  it('payee — matched on the name, not on an id', () => {
    const rule = condition({
      field: 'payee',
      operator: 'contains',
      keywords: ['zabka'],
    })
    expect(matchesCondition(rule, target())).toBe(true)
    expect(matchesCondition(rule, target({ payeeName: 'Biedronka' }))).toBe(
      false,
    )
    expect(matchesCondition(rule, target({ payeeName: null }))).toBe(false)
  })

  it('account — is_any_of and is_none_of', () => {
    const anyOf = condition({
      field: 'account',
      operator: 'is_any_of',
      ids: ['acc-1', 'acc-2'],
    })
    expect(matchesCondition(anyOf, target())).toBe(true)
    expect(matchesCondition(anyOf, target({ accountId: 'acc-9' }))).toBe(false)

    const noneOf = condition({
      field: 'account',
      operator: 'is_none_of',
      ids: ['acc-1'],
    })
    expect(matchesCondition(noneOf, target())).toBe(false)
    expect(matchesCondition(noneOf, target({ accountId: 'acc-9' }))).toBe(true)
  })

  it('account_group — an account may be in several groups, and any of them counts', () => {
    const rule = condition({
      field: 'account_group',
      operator: 'is_any_of',
      ids: ['grp-2'],
    })
    expect(matchesCondition(rule, target())).toBe(false)
    expect(
      matchesCondition(rule, target({ accountGroupIds: ['grp-1', 'grp-2'] })),
    ).toBe(true)
    expect(matchesCondition(rule, target({ accountGroupIds: [] }))).toBe(false)
  })

  it('category — an uncategorised transaction is "none of" every category', () => {
    const anyOf = condition({
      field: 'category',
      operator: 'is_any_of',
      ids: ['cat-1'],
    })
    expect(matchesCondition(anyOf, target())).toBe(false)
    expect(matchesCondition(anyOf, target({ categoryId: 'cat-1' }))).toBe(true)

    const noneOf = condition({
      field: 'category',
      operator: 'is_none_of',
      ids: ['cat-1'],
    })
    expect(matchesCondition(noneOf, target())).toBe(true)
    expect(matchesCondition(noneOf, target({ categoryId: 'cat-1' }))).toBe(
      false,
    )
  })

  it('tag — the transaction may carry several, and the sets intersect or they do not', () => {
    const rule = condition({
      field: 'tag',
      operator: 'is_any_of',
      ids: ['tag-1', 'tag-2'],
    })
    expect(matchesCondition(rule, target({ tagIds: ['tag-3'] }))).toBe(false)
    expect(matchesCondition(rule, target({ tagIds: ['tag-3', 'tag-2'] }))).toBe(
      true,
    )
  })

  it('amount — integer minor units, in the currency the condition names', () => {
    const rule = condition({
      field: 'amount',
      operator: 'gt',
      amountMinor: 50_00,
      currencyCode: 'PLN',
    })
    expect(matchesCondition(rule, target())).toBe(true)
    expect(matchesCondition(rule, target({ amountMinor: 49_99 }))).toBe(false)
  })

  it('direction — income or expense, with no second spelling', () => {
    const rule = condition({ field: 'direction', direction: 'expense' })
    expect(matchesCondition(rule, target())).toBe(true)
    expect(matchesCondition(rule, target({ direction: 'income' }))).toBe(false)
  })

  it('day_of_month — a list of days, read off booked_on', () => {
    const rule = condition({
      field: 'day_of_month',
      operator: 'is_any_of',
      days: [1, 10, 15],
    })
    expect(matchesCondition(rule, target())).toBe(true)
    expect(matchesCondition(rule, target({ bookedOn: '2026-03-11' }))).toBe(
      false,
    )

    // A 31st that no April has simply never matches; nothing is clamped to the 30th.
    const thirtyFirst = condition({
      field: 'day_of_month',
      operator: 'is_any_of',
      days: [31],
    })
    expect(
      matchesCondition(thirtyFirst, target({ bookedOn: '2026-04-30' })),
    ).toBe(false)
    expect(
      matchesCondition(thirtyFirst, target({ bookedOn: '2026-03-31' })),
    ).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* match_mode                                                                  */
/* -------------------------------------------------------------------------- */

describe('match_mode', () => {
  const conditions = ruleConditionsSchema.parse([
    { field: 'direction', direction: 'expense' },
    { field: 'account', operator: 'is_any_of', ids: ['acc-9'] },
  ])

  it('all requires every condition', () => {
    expect(evaluateRule({ matchMode: 'all', conditions }, target())).toBe(false)
    expect(
      evaluateRule(
        { matchMode: 'all', conditions },
        target({ accountId: 'acc-9' }),
      ),
    ).toBe(true)
  })

  it('any requires one', () => {
    expect(evaluateRule({ matchMode: 'any', conditions }, target())).toBe(true)
    expect(
      evaluateRule(
        { matchMode: 'any', conditions },
        target({ direction: 'income' }),
      ),
    ).toBe(false)
  })

  it('an empty condition list matches nothing — never everything', () => {
    // Unsavable by the schema, so this only arises from JSON this version cannot read.
    expect(evaluateRule({ matchMode: 'all', conditions: [] }, target())).toBe(
      false,
    )
    expect(evaluateRule({ matchMode: 'any', conditions: [] }, target())).toBe(
      false,
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

describe('keyword matching goes through the one normaliser', () => {
  const zabka = condition({
    field: 'note',
    operator: 'contains',
    keywords: ['Żabka'],
  })

  it('a rule written against "Żabka" matches "ZABKA 4471"', () => {
    expect(matchesCondition(zabka, target({ note: 'ZABKA 4471' }))).toBe(true)
  })

  it('diacritics, case and punctuation are all folded on both sides', () => {
    expect(
      matchesCondition(zabka, target({ note: 'PLATNOSC KARTA - ŻABKA/W-WA' })),
    ).toBe(true)
  })

  it('a keyword that normalises to nothing matches nothing', () => {
    const punctuation = condition({
      field: 'note',
      operator: 'contains',
      keywords: ['---'],
    })
    expect(matchesCondition(punctuation, target())).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* The money rules                                                             */
/* -------------------------------------------------------------------------- */

describe('an amount condition compares integers in one currency', () => {
  it('does not match a transaction in another currency, and does not convert', () => {
    const inEuro = condition({
      field: 'amount',
      operator: 'gte',
      amountMinor: 10_00,
      currencyCode: 'EUR',
    })
    // 100,00 PLN is more than 10,00 EUR at no rate anybody would apply — and that is the point:
    // the condition answers `false` rather than reaching for one.
    expect(matchesCondition(inEuro, target())).toBe(false)
    expect(matchesCondition(inEuro, target({ currencyCode: 'EUR' }))).toBe(true)
  })

  it('is inclusive exactly where it says so', () => {
    const on = target({ amountMinor: 100_00 })
    const cases: ReadonlyArray<readonly [string, boolean]> = [
      ['eq', true],
      ['gte', true],
      ['lte', true],
      ['gt', false],
      ['lt', false],
    ]
    for (const [operator, expected] of cases) {
      const rule = condition({
        field: 'amount',
        operator,
        amountMinor: 100_00,
        currencyCode: 'PLN',
      })
      expect(matchesCondition(rule, on), operator).toBe(expected)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The ceilings                                                                */
/* -------------------------------------------------------------------------- */

describe('every ceiling refuses rather than truncates', () => {
  const idCondition = (count: number) => ({
    field: 'account',
    operator: 'is_any_of',
    ids: Array.from({ length: count }, (_, index) => `acc-${index}`),
  })
  const keywordCondition = (count: number, length = 4) => ({
    field: 'note',
    operator: 'contains',
    keywords: Array.from({ length: count }, () => 'a'.repeat(length)),
  })
  const noteAction = (length: number) => ({
    kind: 'set_note',
    note: 'a'.repeat(length),
  })

  it('10 conditions per rule', () => {
    const ten = Array.from({ length: MAX_CONDITIONS_PER_RULE }, () =>
      keywordCondition(1),
    )
    expect(ruleConditionsSchema.parse(ten)).toHaveLength(
      MAX_CONDITIONS_PER_RULE,
    )
    expect(
      ruleConditionsSchema.safeParse([...ten, keywordCondition(1)]).success,
    ).toBe(false)
  })

  it('20 keywords per condition, and 64 characters per keyword', () => {
    expect(
      ruleConditionSchema.parse(keywordCondition(MAX_KEYWORDS_PER_CONDITION)),
    ).toMatchObject({ keywords: expect.any(Array) })
    expect(
      ruleConditionSchema.safeParse(
        keywordCondition(MAX_KEYWORDS_PER_CONDITION + 1),
      ).success,
    ).toBe(false)

    expect(
      ruleConditionSchema.safeParse(keywordCondition(1, MAX_KEYWORD_LENGTH))
        .success,
    ).toBe(true)
    expect(
      ruleConditionSchema.safeParse(keywordCondition(1, MAX_KEYWORD_LENGTH + 1))
        .success,
    ).toBe(false)
  })

  it('20 ids per id-condition', () => {
    expect(
      ruleConditionSchema.safeParse(idCondition(MAX_IDS_PER_CONDITION)).success,
    ).toBe(true)
    expect(
      ruleConditionSchema.safeParse(idCondition(MAX_IDS_PER_CONDITION + 1))
        .success,
    ).toBe(false)
  })

  it('4 actions per rule', () => {
    const four = Array.from({ length: MAX_ACTIONS_PER_RULE }, (_, index) => ({
      kind: 'add_tag',
      tagId: `tag-${index}`,
    }))
    expect(ruleActionsSchema.parse(four)).toHaveLength(MAX_ACTIONS_PER_RULE)
    expect(
      ruleActionsSchema.safeParse([
        ...four,
        { kind: 'add_tag', tagId: 'tag-x' },
      ]).success,
    ).toBe(false)
  })

  it('200 characters in a set_note action', () => {
    expect(
      ruleActionsSchema.safeParse([noteAction(MAX_ACTION_NOTE_LENGTH)]).success,
    ).toBe(true)
    expect(
      ruleActionsSchema.safeParse([noteAction(MAX_ACTION_NOTE_LENGTH + 1)])
        .success,
    ).toBe(false)
  })

  it('an over-sized payload is refused whole, never accepted trimmed', () => {
    const parsed = ruleConditionSchema.safeParse(
      keywordCondition(MAX_KEYWORDS_PER_CONDITION + 1),
    )
    expect(parsed.success).toBe(false)
    // No `data` at all: nothing was silently kept, which is what "refuses rather than truncates"
    // has to mean if a person is to trust the rule they saved.
    expect(parsed.success ? parsed.data : undefined).toBeUndefined()
  })

  it('a rule with no conditions or no actions is refused', () => {
    expect(ruleConditionsSchema.safeParse([]).success).toBe(false)
    expect(ruleActionsSchema.safeParse([]).success).toBe(false)
  })

  it('a tenth condition field and a ninth action kind are refused', () => {
    expect(
      ruleConditionSchema.safeParse({
        field: 'bank_connection',
        operator: 'is_any_of',
        ids: ['conn-1'],
      }).success,
    ).toBe(false)
    expect(
      ruleActionsSchema.safeParse([{ kind: 'set_amount', amountMinor: 1 }])
        .success,
    ).toBe(false)
  })

  it('an unknown key on a known condition is refused, not ignored', () => {
    expect(
      ruleConditionSchema.safeParse({
        field: 'direction',
        direction: 'expense',
        andAlso: 'something',
      }).success,
    ).toBe(false)
  })

  it('run_on de-duplicates and accepts the empty, inert list', () => {
    const definition = ruleDefinitionSchema.parse({
      name: 'Groceries',
      conditions: [keywordCondition(1)],
      actions: [{ kind: 'add_tag', tagId: 'tag-1' }],
      runOn: ['import', 'import', 'edit'],
    })
    expect(definition.runOn).toEqual(['import', 'edit'])
    expect(definition.matchMode).toBe('all')

    const inert = ruleDefinitionSchema.parse({
      name: 'Inert',
      conditions: [keywordCondition(1)],
      actions: [{ kind: 'add_tag', tagId: 'tag-1' }],
      runOn: [],
    })
    expect(inert.runOn).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The number that decides whether the import preview is usable                */
/* -------------------------------------------------------------------------- */

describe('100 rules over 5 000 transactions', () => {
  /**
   * The property the memo exists for, asserted by counting rather than by timing.
   *
   * Over R rules and T transactions the evaluator folds **R + T** distinct strings — every note
   * once and every keyword once — not one per pair. Without the memo the same loop calls the
   * normaliser 2 × R × T times, so this fails by a factor of forty on any machine, at any load, in
   * milliseconds. A wall-clock bound could only ever be a proxy for this, and a proxy calibrated on
   * one laptop is a proxy that goes red on a CI runner and gets deleted.
   *
   * Every string is prefixed uniquely so it is cold: the memo is module-level and the cases above
   * have already folded "zabka" and its neighbours.
   */
  it('normalises once per distinct string, not once per rule × transaction', () => {
    const RULES = 20
    const TRANSACTIONS = 200

    const rules = Array.from({ length: RULES }, (_, index) => ({
      matchMode: 'all' as const,
      conditions: ruleConditionsSchema.parse([
        {
          field: 'note',
          operator: 'contains',
          keywords: [`countedkeyword${String(index).padStart(2, '0')}x`],
        },
      ]),
    }))
    const targets = Array.from({ length: TRANSACTIONS }, (_, index) =>
      target({
        // Zero-padded and terminated, so no keyword is a prefix of another and each transaction
        // matches exactly one rule — the count below is then a fact rather than a coincidence.
        note: `countednote ${index} countedkeyword${String(index % RULES).padStart(2, '0')}x`,
      }),
    )

    const before = normalisations.count
    let matches = 0
    for (const subject of targets) {
      for (const rule of rules) {
        if (evaluateRule(rule, subject)) matches += 1
      }
    }
    const folded = normalisations.count - before

    // Every transaction matched exactly one rule, so the loop did the work it claims to have done.
    expect(matches).toBe(TRANSACTIONS)
    expect(folded).toBe(RULES + TRANSACTIONS)
    // Said the other way, because this is the number that matters: it is not R × T.
    expect(folded).toBeLessThan(RULES * TRANSACTIONS)
  })

  /**
   * The plan's number, run for real — a smoke test that half a million evaluations complete and
   * produce answers, with no timing assertion. The regression gate is the counted case above.
   */
  it('completes half a million evaluations', () => {
    const rules = Array.from({ length: 100 }, (_, index) => ({
      matchMode: 'all' as const,
      conditions: ruleConditionsSchema.parse([
        { field: 'direction', direction: 'expense' },
        { field: 'note', operator: 'contains', keywords: [`keyword${index}`] },
        {
          field: 'amount',
          operator: 'gte',
          amountMinor: index * 100,
          currencyCode: 'PLN',
        },
      ]),
    }))
    const targets = Array.from({ length: 5_000 }, (_, index) =>
      target({
        note: `PAYMENT ${index} keyword${index % 100}`,
        amountMinor: index * 7,
      }),
    )

    let matches = 0
    for (const subject of targets) {
      for (const rule of rules) {
        if (evaluateRule(rule, subject)) matches += 1
      }
    }

    expect(matches).toBeGreaterThan(0)
  })
})
