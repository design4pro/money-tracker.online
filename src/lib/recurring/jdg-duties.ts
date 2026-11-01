/**
 * Polish JDG due-date templates: the shape of a duty, never a tax engine.
 *
 * Three series a sole trader typically tracks — ZUS on the 20th, a PIT-36L advance on the 20th,
 * VAT-7 on the 25th. The product stores the day the person chose and the amount they typed. It
 * does not compute a contribution, a taxable base or a return, and it does not file anything.
 *
 * Names live in the catalogue (`recurring.duty.*`). This module is the **dates and the codes**,
 * so a form, a test and a seed all apply the same 20 / 20 / 25 without copying the numbers.
 */

import { RECURRING_DUTY_CODES } from '#/lib/enums'

import type {
  RecurringDutyCode,
  RecurringFrequency,
  RecurringKind,
} from '#/lib/enums'

export interface JdgDutyTemplate {
  readonly code: RecurringDutyCode
  readonly kind: RecurringKind
  readonly frequency: RecurringFrequency
  readonly anchorDay: number
}

export const JDG_DUTY_TEMPLATES: ReadonlyArray<JdgDutyTemplate> = [
  { code: 'zus', kind: 'bill', frequency: 'monthly', anchorDay: 20 },
  { code: 'pit', kind: 'bill', frequency: 'monthly', anchorDay: 20 },
  { code: 'vat_7', kind: 'bill', frequency: 'monthly', anchorDay: 25 },
]

const BY_CODE: ReadonlyMap<RecurringDutyCode, JdgDutyTemplate> = new Map(
  JDG_DUTY_TEMPLATES.map((template) => [template.code, template]),
)

export function jdgDutyTemplate(
  code: RecurringDutyCode,
): JdgDutyTemplate | undefined {
  return BY_CODE.get(code)
}

export function isRecurringDutyCode(value: string): value is RecurringDutyCode {
  return (RECURRING_DUTY_CODES as ReadonlyArray<string>).includes(value)
}
