import { describe, expect, it } from 'vitest'

import { isPanelDirty, pruneFilters } from '../filter-bar'
import { DEFAULT_LEDGER_SORT, NO_FILTERS } from '../types'

import type { LedgerFilters, LedgerSort } from '../types'

/**
 * The filter panel's unsaved-changes guard, over the shapes the controls actually produce.
 *
 * The panel's baseline comes from `toFilters`, which emits no key for a narrowing that is not in
 * force. Its draft comes from the controls, which write whatever they hold — an emptied checkbox
 * group writes `[]`, a cleared amount field leaves its resolved currency behind. Both mean "no
 * narrowing", so the guard has to read them as the baseline does, or it asks about work nobody
 * did for the rest of that open.
 */

const view = (filters: LedgerFilters, sort: LedgerSort = DEFAULT_LEDGER_SORT) =>
  ({ filters, sort }) as const

describe('pruneFilters', () => {
  it('drops an empty list, so an untouched checkbox group leaves no key', () => {
    expect(pruneFilters({ tagIds: [], text: 'rent' })).toEqual({ text: 'rent' })
  })

  it('drops an amount currency that has no bound to denominate', () => {
    expect(pruneFilters({ amountCurrency: 'PLN' })).toEqual({})
  })

  it('keeps the currency once a bound is in force, because the bound needs it', () => {
    expect(
      pruneFilters({ amountCurrency: 'PLN', amountMinMinor: 1000 }),
    ).toEqual({ amountCurrency: 'PLN', amountMinMinor: 1000 })
  })
})

describe('isPanelDirty', () => {
  it('reads a draft that matches the applied view as pristine', () => {
    expect(isPanelDirty(view({ text: 'rent' }), view({ text: 'rent' }))).toBe(
      false,
    )
  })

  it('reads a real narrowing as dirty', () => {
    expect(isPanelDirty(view({ tagIds: ['a'] }), view(NO_FILTERS))).toBe(true)
  })

  // Tick a checkbox then untick it: the group's `onChange` writes `[]` into the draft while the
  // baseline never had that key at all. Nothing narrows the ledger, so nothing is at stake.
  it('reads a list ticked and unticked again as pristine', () => {
    expect(isPanelDirty(view({ tagIds: [] }), view(NO_FILTERS))).toBe(false)
  })

  // Type an amount then clear it: the field patches `amountMinMinor: undefined` alongside the
  // currency it resolved, and that currency alone narrows nothing — `toSearch` will not even
  // emit it.
  it('reads an amount typed and cleared again as pristine', () => {
    expect(
      isPanelDirty(
        view({ amountMinMinor: undefined, amountCurrency: 'PLN' }),
        view(NO_FILTERS),
      ),
    ).toBe(false)
  })

  it('reads a changed sort as dirty, because the same close discards it', () => {
    expect(
      isPanelDirty(
        view(NO_FILTERS, { field: 'payee', direction: 'asc' }),
        view(NO_FILTERS),
      ),
    ).toBe(true)
  })
})
