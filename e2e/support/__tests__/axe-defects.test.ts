import { describe, expect, it } from 'vitest'

import { ariaAllowedAttrFlaggedValues } from '../axe-defects'

/**
 * The meter-fallback correction reads the list of attributes axe named. That list is the
 * contract with the tool: 4.13 put it on `check.data` as a string array; 4.14 wrapped the
 * same strings in `{ messageKey, values }`. If the parser only understands one shape, the
 * next axe bump silently stops dropping the known false positive (PR #881 CI).
 */

const METER_VALUES = [
  'aria-valuenow="0.169211"',
  'aria-valuemin="0"',
  'aria-valuemax="1"',
  'aria-valuetext="17%"',
] as const

describe('ariaAllowedAttrFlaggedValues', () => {
  it('reads axe-core 4.13 check.data as a string array', () => {
    expect(ariaAllowedAttrFlaggedValues([...METER_VALUES])).toEqual([
      ...METER_VALUES,
    ])
  })

  it('reads axe-core 4.14 check.data.values', () => {
    expect(
      ariaAllowedAttrFlaggedValues({
        messageKey: 'plural',
        values: [...METER_VALUES],
      }),
    ).toEqual([...METER_VALUES])
  })

  it('returns null when the payload is not either known shape', () => {
    expect(ariaAllowedAttrFlaggedValues(undefined)).toBeNull()
    expect(ariaAllowedAttrFlaggedValues({ messageKey: 'plural' })).toBeNull()
    expect(ariaAllowedAttrFlaggedValues({ values: 'aria-valuenow' })).toBeNull()
  })
})
