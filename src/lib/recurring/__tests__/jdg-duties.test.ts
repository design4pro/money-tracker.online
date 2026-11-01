/**
 * The JDG templates are a due-date shape. The numbers below were read off a calendar, not
 * computed, and they are the whole product claim: 20th, 20th, 25th, amounts elsewhere.
 */

import { describe, expect, it } from 'vitest'

import { JDG_DUTY_TEMPLATES, jdgDutyTemplate } from '../jdg-duties'

describe('JDG duty templates', () => {
  it('pins ZUS and the PIT advance on the 20th and VAT-7 on the 25th', () => {
    expect(JDG_DUTY_TEMPLATES.map((row) => [row.code, row.anchorDay])).toEqual([
      ['zus', 20],
      ['pit', 20],
      ['vat_7', 25],
    ])
  })

  it('is a monthly bill, never a yearly tax engine', () => {
    for (const row of JDG_DUTY_TEMPLATES) {
      expect(row.frequency).toBe('monthly')
      expect(row.kind).toBe('bill')
    }
  })

  it('looks a code up without inventing a fourth duty', () => {
    expect(jdgDutyTemplate('zus')?.anchorDay).toBe(20)
    expect(jdgDutyTemplate('vat_7')?.anchorDay).toBe(25)
  })
})
